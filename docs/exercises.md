# Exercises — learn this system by changing it

These go from "change one number" to "add a whole feature". Do them in
order; each one teaches something the next one needs.

**How to work safely:** make a branch first (`git checkout -b my-change`),
and open `dashboard/index.html` in a browser to see your change. If you
break something badly, `git checkout .` throws away your edits and you
are back to a working board. Nothing you do here can hurt the real TV
until someone pushes to the main branch.

**Two tools you will use constantly:**

- Add `?time=13:00` to the URL to pretend it is a different time of day.
- Press **F12** in the browser for the developer console. Errors show up
  there in red — that is the first place to look when nothing happens.

---

## 1. Change a color (5 minutes)

Every grade has an accent color, defined at the top of
[`dashboard/style.css`](../dashboard/style.css) as `--g1` … `--g7`.

- Change `--g1` to `#ff0077` and reload. Which grade changed?
- Now find where `--g1` is *used*. Why did the exam chip for that grade
  change color too, when you only edited one line?

**What this teaches:** CSS custom properties as a single source of truth.
The colors are defined once and referenced everywhere, which is why one
edit changed several places at once.

> Bonus question: the comment says these colors are colorblind-safe.
> Your new pink probably isn't. What would you need to check to know?

## 2. Make the board update faster (10 minutes)

Open [`dashboard/config.js`](../dashboard/config.js) and change
`refreshSeconds` from 60 to 10.

- How would you *prove* it now reloads every 10 seconds? (Hint: F12 →
  Network tab, watch the requests appear.)
- Now set it to `1`. Is that a good idea? What is being requested, and
  who is on the other end of that request?

**What this teaches:** every config value is a trade-off, not a
preference. Faster updates cost network requests and battery/CPU; Google
will also throttle you if you hammer it.

## 3. Add a new panel to the board (30 minutes)

Add a small panel showing the current week number.

1. In [`dashboard/index.html`](../dashboard/index.html), find the
   `<footer>` and add a `<div id="weeknum"></div>` before `#stamp`.
2. In [`dashboard/style.css`](../dashboard/style.css), give it a font
   size and color (copy how `#stamp` is styled).
3. In [`dashboard/app.js`](../dashboard/app.js), inside `tick()`, set its
   text. You will need to calculate the week number yourself.

**Where it gets interesting:** put your week-number calculation in
[`dashboard/logic.js`](../dashboard/logic.js) instead of `app.js`, export
it, and add a test for it in [`tests/run.js`](../tests/run.js). Then run
`node tests/run.js`.

**What this teaches:** the split that runs through this whole project —
pure calculations live in `logic.js` where they can be tested; anything
touching the screen or the clock lives in `app.js`. Ask yourself why a
week-number calculation belongs on the testable side.

## 4. Break the data on purpose (20 minutes)

Open [`dashboard/sample-data.js`](../dashboard/sample-data.js) and
sabotage it, one thing at a time, reloading after each:

1. Change a time from `08:00` to `8 in the morning`.
2. Delete a whole column from one row of the schedule.
3. Change a date in `examsCsv` to `לא תאריך`.
4. Put an emoji, a comma **and** a quotation mark in a message.
5. Type `<script>alert('hi')</script>` as a message.

For each one: what happened on the board? Did the whole board die, or
just the bad row? Find the line in `logic.js` that made that decision.

**What this teaches:** the most important design rule in this project —
*one bad row must never blank the board*. A school secretary will
eventually type something strange, and the corridor screen must survive
it. Number 5 is why every piece of sheet text passes through `esc()`.

## 5. Understand the paging animation (30 minutes)

Set `?time=08:00` so every card is full. Watch a card with many classes.

1. In `app.js`, find `layoutCard()`. Where do the numbers it packs come
   from — the stylesheet, or the rendered page?
2. This function replaced `perPage = floor(paneH / 52)`, where 52 was a
   constant that had to match `.period`'s height in the CSS. Find
   `packPages()` in `logic.js` and work out what changed about the rows
   that made a single constant impossible.
3. `packPages()` is given whole `.slot` boxes, never lines. Try to write
   a version that could show 2 of 3 concurrent classes. Why can't you —
   and why is that a better guarantee than a check that the page did not
   split a group?

**What this teaches:** a constant duplicated between CSS and JS is a
classic source of bugs, and the usual fix is to measure instead of
assume. The second half is about the stronger move: choosing a data
structure in which the bug cannot be expressed.

## 6. Set up your own Pi (an afternoon)

Follow [`../pi/README.md`](../pi/README.md) on a Raspberry Pi with any
monitor. Then do the tests at the end of it — especially pulling the
power plug.

**What this teaches:** more than everything above combined. Flashing an
OS, SSH, autostart, cron, and the difference between "it works when I
launch it" and "it works when nobody is there".

---

## If you want to go further

- **Why can't this run on the TV itself?** Read
  [`decisions.md`](decisions.md). The answer is more interesting than
  "Samsung won't let us".
- **Add a feature the board doesn't have**: a weather line, a countdown
  to the end of the current class, a birthday greeting from a new sheet
  tab. Start by writing down what data you need, then which file each
  piece of your change belongs in. That planning step is the actual
  skill.
