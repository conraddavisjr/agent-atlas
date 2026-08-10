#!/bin/zsh
# Bring the capture tab to the front, and un-minimise its window.
#
# The tab must be the ACTIVE tab of a non-minimised, non-zero-sized window at
# mount time, or r3f never measures its container: the canvas stays at its
# 300x150 default and every capture afterwards is a valid PNG of nothing. That
# state is indistinguishable from a renderer crash from the outside.
#
# Reloading the page drops activation, so this has to run after every
# navigation. Matched on the TITLE rather than the URL, because several tabs
# usually share the localhost URL and only one of them is the capture tab: set
# `document.title = 'ATLAS-CAPTURE'` from the page first, which works fine on a
# tab that is currently hidden.
#
# `set minimized of w to false`, not `miniaturized`, which is silently ignored.
TITLE="${1:-ATLAS-CAPTURE}"
osascript <<EOF
tell application "Google Chrome"
  activate
  set found to "not found"
  repeat with wi from 1 to (count of windows)
    set w to window wi
    try
      set minimized of w to false
    end try
    repeat with ti from 1 to (count of tabs of w)
      if (title of tab ti of w) is "$TITLE" then
        set active tab index of w to ti
        set index of w to 1
        set found to "window " & wi & " tab " & ti
      end if
    end repeat
  end repeat
  return found
end tell
EOF
