// The capture driver, fetched into the page after every reload.
//
// It wraps __dev rather than replacing it. Three things it adds that the
// in-page harness deliberately does not have: a pinned drawing BUFFER (not a
// pinned CSS size), a whole-frame luma histogram, and a way to get the PNG off
// the page, since the page cannot write files.
;(() => {
  const SINK = 'http://127.0.0.1:7345'
  const BUF = [1660, 934]

  const post = async (path, name, payload) => {
    const r = await fetch(SINK + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(path === '/shot' ? { name, dataUrl: payload } : { name, data: payload }),
    })
    return r.json()
  }

  window.__r3 = {
    /**
     * Pin the drawing buffer to 1660x934, whatever the window and display do.
     *
     * The r3f <Canvas> wrapper is a position:fixed inset:0 div, so it tracks
     * the window; giving it explicit pixel dimensions and firing a synthetic
     * resize is what makes r3f re-measure. Without the event its
     * ResizeObserver has already fired for the old size and nothing re-runs.
     * With pinDpr(1) the buffer then equals the CSS box, so a sample() rect
     * means the same thing in every run and on either display.
     */
    async pin() {
      const c = document.querySelector('canvas')
      const wrapper = c.parentElement.parentElement
      wrapper.style.width = BUF[0] + 'px'
      wrapper.style.height = BUF[1] + 'px'
      wrapper.style.inset = 'auto'
      wrapper.style.left = '0px'
      wrapper.style.top = '0px'
      window.dispatchEvent(new Event('resize'))
      window.__dev.pinDpr(1)
      await new Promise((r) => setTimeout(r, 500))
      window.__dev.pinDpr(1)
      return { canvas: [c.width, c.height], devicePixelRatio }
    },

    /** Whole-frame Rec.709 luma histogram. __dev has no distribution, only scalars. */
    histogram(buckets = 20) {
      const src = window.__dev.gl.domElement
      const probe = document.createElement('canvas')
      probe.width = src.width
      probe.height = src.height
      const ctx = probe.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(src, 0, 0)
      const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
      const hist = new Array(buckets).fill(0)
      let n = 0, sum = 0, minAlpha = 255
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < minAlpha) minAlpha = data[i + 3]
        const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
        hist[Math.min(buckets - 1, Math.floor(l * buckets))]++
        sum += l
        n++
      }
      const below = (t) => {
        let c = 0
        for (let b = 0; b < buckets; b++) if ((b + 1) / buckets <= t + 1e-9) c += hist[b]
        return +(100 * c / n).toFixed(2)
      }
      return {
        buffer: [probe.width, probe.height], minAlpha, mean: +(sum / n).toFixed(4),
        below010: below(0.1), below020: below(0.2), below030: below(0.3),
        above080: +(100 * (hist[16] + hist[17] + hist[18] + hist[19]) / n).toFixed(2),
      }
    },

    post,

    /** One vantage: capture, verify the capture, measure it, write the PNG out. */
    async shoot(vantage, prefix) {
      const report = await window.__dev.capture(vantage)
      const ok =
        report.drew &&
        (report.referenceTriangles === 0 || report.triangles >= report.referenceTriangles * 0.5)
      const framing = window.__dev.framing()
      const hist = this.histogram()
      const name = `${prefix}--${vantage}`
      const png = await post('/shot', name, window.__dev.gl.domElement.toDataURL('image/png'))
      await post('/json', name, { name, ok, report, framing, hist, png, camera: window.__dev.cameraState() })
      return {
        name, ok, attempts: report.attempts, bytes: png.bytes, mean: hist.mean,
        below010: hist.below010, below020: hist.below020, below030: hist.below030,
        above080: hist.above080, buffer: hist.buffer,
        lessons: report.progress.completedLessons.length + '/' + report.progress.of,
      }
    },

    /**
     * Everything a capture set needs pinned, in one call, in the order that
     * matters. Progression LAST relative to nothing, but before settling, so
     * the totems and the Core rings are in their final state when the triangle
     * yardstick is recorded.
     */
    async ready() {
      const pinned = await this.pin()
      const progress = window.__dev.setProgress('all')
      window.__dev.hideHud()
      const settled = await window.__dev.settled()
      return { pinned, progress, settled, frameStats: window.__dev.frameStats(), url: location.href }
    },

    async session(prefix, vantages) {
      const out = []
      for (const v of vantages) out.push(await this.shoot(v, prefix))
      return out
    },

    /** The six, in the order __dev.vantages() returns them. */
    ALL: ['hub-establishing', 'hub-portal', 'hub-character', 'hub-grazing', 'hub-totem', 'hub-backlit'],

    /**
     * Alternating A/B of two URL configurations is impossible in one page load,
     * so this is the within-load half: n runs of fps() back to back, so the
     * spread inside one configuration is visible and can be compared with the
     * spread between configurations. The handoff's warning is the reason: the
     * same config read 65.5 mean in one session and 21 to 36 in another, while
     * four consecutive runs inside one session agreed to 0.4 fps.
     */
    async fpsRuns(n = 3, seconds = 5) {
      const out = []
      for (let i = 0; i < n; i++) out.push(await window.__dev.fps(seconds))
      return out
    },
  }
  return 'harness installed'
})()
