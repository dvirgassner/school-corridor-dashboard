# Working rules for this project

## ⛔ NEVER RISK THE PI'S NETWORK CONNECTION

The Raspberry Pi (`kit`) is mounted on a wall in a school that Dvir does
not work at, driving a TV in a corridor. **Do not take, and do not
suggest, any action that could cost it its network connection.**

Losing the network costs two things at once:

1. The board stops showing current data — it can no longer read the sheet.
2. **SSH stops working**, so it cannot be fixed remotely at all.

Recovery then means physically travelling to the school with a keyboard
and mouse. This has already happened once: `sudo ip link set wlan0 down`,
suggested as a way to test the service worker's offline behaviour,
stranded the Pi — and the person fixing it faced a Hebrew-only keyboard.

### Treat as untouchable

Wi-Fi and `wlan0` · NetworkManager / wpa_supplicant · DNS · routing ·
firewall · `rfkill` · hostname · Tailscale config or logout ·
`apt upgrade` / `dist-upgrade` (kernel and Wi-Fi driver changes).

### Never test a failure by causing it

Offline behaviour, network-loss handling and similar failure modes are
tested on a bench machine or in a desktop browser — never on the wall.

### Reboots are the borderline case

A reboot changes no configuration, but it does gamble on Wi-Fi coming
back by itself. Reboot only when Dvir asks, or when it is genuinely the
last option, and say plainly that it is a gamble first.

### One more trap, learned twice

Never use `pkill -f <pattern>` where the pattern could match the SSH
command carrying it — the pattern matches your own command line and
kills the session mid-run. Use `pkill -x <name>` or an explicit PID.

## Other standing facts

- SSH is always `ssh dvir@kit` — a bare `ssh kit` uses the PC's username
  and fails.
- Recovery instructions must not assume SSH works: also give a path a
  person standing at the TV with a keyboard can follow.
- The board is served from GitHub Pages; the sheet token lives only in
  `~/.dashboard-env` on the Pi and never in this repository.
