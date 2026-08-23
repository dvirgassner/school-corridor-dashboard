# Pushing the script to the sheet automatically

Pasting `setup.gs` into the Apps Script editor by hand is tedious and
error-prone — a clipped first character produced a confusing syntax
error more than once. `clasp`, Google's official Apps Script CLI,
replaces that with one command.

## One-time setup (three steps, only you can do these)

**1. Turn on the Apps Script API for your Google account**

<https://script.google.com/home/usersettings> → set *Google Apps Script
API* to **On**. Without this, `clasp push` fails with a 403.

**2. Log in**

```bash
clasp login
```

A browser window opens; approve the access. This writes credentials to
`~/.clasprc.json` on this machine — treat that file like a password, and
never commit it.

**3. Point clasp at the sheet's script**

The script bound to the spreadsheet already exists, so link to it rather
than creating a new one:

```bash
cd sheet-template
clasp clone <SCRIPT_ID>      # or: clasp list  to find it
```

Find `<SCRIPT_ID>` in the Apps Script editor under **Project Settings →
IDs → Script ID**.

`clasp clone` writes `.clasp.json`, which is **git-ignored on purpose**:
the repository is public, and there is no reason to publish which script
project belongs to the school.

## Pushing a change

```bash
cd sheet-template
clasp push -f
```

That uploads `setup.gs`, `fix-settings.gs` and `appsscript.json`,
replacing what is in the editor. Reload the spreadsheet afterwards so
the `לוח מסדרון` menu is rebuilt, then run `setup` (or `checkVersion` to
confirm which version landed).

## Why the manifest is here

`appsscript.json` pins the V8 runtime and `Asia/Jerusalem`. clasp
requires a manifest, and pinning the timezone matters: the script writes
`new Date()` into the exam and event rows, and a project defaulting to
US/Pacific would date them a day early for part of the evening.

## What this does not change

The script still has to be *bound* to the spreadsheet for `onEdit` and
`onOpen` to work — clasp updates the bound project's contents, it does
not turn a standalone script into a bound one. If you ever start from a
fresh sheet, create the bound project once via **Extensions → Apps
Script**, then `clasp clone` its ID.
