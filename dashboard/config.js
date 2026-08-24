/* ==================================================================
   config.js — display settings. Deliberately contains NO sheet URLs.

   Where the board gets its data (first match wins):

     1. THE URL FRAGMENT — how the real deployment works.
        The Pi opens the board with the sheet's publish token in the
        fragment, which is stored only on the Pi (~/.dashboard-env):

          https://you.github.io/repo/dashboard/#t=<token>&g=<gid>,<gid>,<gid>,<gid>
                                            (schedule,exams,events,messages)

        A fragment is never sent to the web server, so the token stays
        between the Pi and Google, and this repository can stay public
        without exposing the school's data. See sheet-template/README.md
        for how to collect the token and the four gids.

     2. `sheets` below — only for a deployment where holding the URLs in
        code is acceptable (e.g. files served from the Pi itself).
        Leave it null otherwise.

     3. Neither → DEMO MODE: bundled sample data, clock pinned to 08:10.
        This is what a visitor to the public URL sees.
   ================================================================== */
window.DASH_CONFIG = {
  sheets: null,

  /* Shown bottom-left so you can tell at a glance which build a screen
     is running when someone reports a problem. Bump it when you deploy
     something you might need to identify later. */
  version: "0.164",

  refreshSeconds: 60,        /* how often to re-read the sheet        */
  /* How often to check whether a new build has been published. On a
     change of `version` above, the board reloads itself — otherwise a fix
     waits for the nightly reboot. GitHub caches assets for 10 minutes,
     so checking much more often than that buys nothing. */
  updateCheckMinutes: 15,
  staleMinutes: 10,          /* stamp turns amber after this long     */
  videoIntervalMinutes: 10,  /* minimum gap between video plays       */
  /* A YouTube embed gives no "finished" signal without loading YouTube's
     own API, so this caps how long the overlay can cover the board.
     Set it a little above your longest clip. */
  youtubeMaxMinutes: 6,
  schoolName: "תיכון השיטה",

  /* Wall-clock timezone for the board. Daylight saving is applied
     automatically from the timezone database — there is nothing to
     change twice a year. Setting this explicitly means the board is
     right even if the Pi's own timezone was never configured. */
  timeZone: "Asia/Jerusalem"
};
