# ⚡ BMS Battery Card v5

> A glassmorphism-styled Home Assistant Lovelace card for JK / PACE / Daly BMS systems.  
> Connects via MQTT, RS-485 or any integration that exposes BMS data as HA sensor entities.  
> Designed for LiFePO₄ packs — works with any cell chemistry whose voltage range you configure.

---

## What it looks like

```
┌─────────────────────────────────────────────────────────┐
│ 🔋 My Battery          JK BMS ● Live       ⚡ CHARGING  │
│ ─────────────────── gradient accent bar ─────────────── │
│                                                         │
│  ╭──── SOC gauge ────╮   🔌 Voltage   ⚡ Current        │
│  │       87%         │   53.2 V       +14.3 A           │
│  │   410.5 / 472 Ah  │   🔋 Remaining  ⏱ Time Left     │
│  │    ⏱ 3h 20m       │   410.5 Ah     3h 20m           │
│  ╰───────────────────╯   [CHG FET ON ] [DIS FET ON ]   │
│                                                         │
│  ⚡ Power Flow                                          │
│  ☀ 750W  ──●●●──▶  🔋 87%  ──●●●──▶  🏠 0W            │
│                                                         │
│  🔬 Cell Voltages                          ΔV 2.1 mV   │
│  [C1▲] [C2 ] [C3 ] [C4 ] [C5 ] [C6 ] [C7 ] [C8▼]     │
│  3.325  3.322 3.324 3.321 3.323 3.322 3.325 3.320      │
│                                                         │
│  🌡️ Temperature                                         │
│  [Bat1 24°] [Bat2 25°] [Bat3 24°] [Bat4 23°] [MOS 31°]│
│                                                         │
│  ⚡ Charge  🔌 Discharge  ◉ Balance                     │
│  ─────────────────────────────────────────────────────  │
│  🔄 12    ⏱ 23d 4h   ⚡ 3.322V   🔋 14820 Ah           │
│  ⬇ Energy In: 1.842 kWh   ⬆ Energy Out: 0.317 kWh     │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Auto reset period…  ▼  │  AUTO  │ ⟳ Manual Reset │  │
│  └──────────────────────────────────────────────────┘  │
│  ● All systems OK                                       │
└─────────────────────────────────────────────────────────┘
```

<img width="528" height="833" alt="image" src="https://github.com/user-attachments/assets/fcdfa9d3-8429-490c-98d9-d3a9a1d2a3a5" />
<img width="529" height="556" alt="image" src="https://github.com/user-attachments/assets/d80a858e-a8b6-445f-b528-d6b40ace793e" />


---

## Features

| Feature | Description |
|---|---|
| **3-D liquid cells** | Each cell is a volumetric tube with an animated wave surface; liquid level reflects voltage relative to configured min/max |
| **SOC arc gauge** | Large circular gauge colour-coded green → yellow → orange → red by charge level |
| **Comet-trail power flow** | Animated orbs travel along Bézier arcs between source, battery and load; speed scales with real power |
| **⚡ CHARGING badge** | Blue glowing corner badge appears automatically when current > 0.5 A |
| **Connection health** | After `staleTimeout` seconds with no entity update the card goes monochrome — greyscale gauge, dimmed flow, blinking "Connection Lost" indicator |
| **Auto Reset** | Energy counters reset automatically on a daily / weekly / monthly schedule; state syncs across all devices via HA's server-side user storage |
| **Manual Reset** | Long-press the button for 2 seconds — a red fill bar sweeps left→right; release early to cancel, hold to confirm |
| **MOSFET status chips** | CHG FET / DIS FET show ON / OFF / TRIPPED with colour-coded LEDs |
| **Responsive layout** | CSS container queries give 5 adaptive tiers from 12-column narrow to 48-column desktop — no overlap, no clipping |
| **Glassmorphism UI** | Dark frosted-glass design with animated gradient accents |

---

## Installation

### 1 — Copy the JavaScript file

Copy `bms-battery-card-v5.js` to your Home Assistant `www` folder:

```
/config/www/bms-battery-card-v5.js
or /homeassistant/www/bms-battery-card-v5.js
```

Create the `www` folder if it does not exist.

### 2 — Register the resource

**Via the UI:** Settings → Dashboards → ⋮ → Resources → **+ Add resource**  
URL: `/local/bms-battery-card-v5.js` | Type: **JavaScript module**

**Or in `configuration.yaml`:**
```yaml
lovelace:
  resources:
    - url: /local/bms-battery-card-v5.js
      type: module
```

Restart Home Assistant (or do a full browser hard-refresh with **Ctrl + Shift + R**).

### 3 — Add the card

Open your dashboard in **Edit** mode → **+ Add Card** → **Manual card** and paste from `bms-card-config-v5_example.yaml` in this folder.  
Replace every `sensor.your_bms_*` placeholder with your actual entity IDs.

---

## Files in this folder

| File | Purpose |
|---|---|
| `bms-battery-card-v5.js` | The card — copy this to `/config/www/` |
| `bms-card-config-v5_example.yaml` | Starter config with every option documented — use this as your template |

---

## Configuration reference

### Top-level options

| Key | Type | Default | Description |
|---|---|---|---|
| `type` | string | — | Must be `custom:bms-battery-card-v5` |
| `title` | string | `Battery BMS` | Text shown in the card header |
| `cellCount` | integer | `4` | Number of cells in the pack; controls how many 3-D tubes are rendered |
| `minCellVoltage` | float | `3.0` | Voltage mapped to 0 % liquid fill (cell appears empty). LiFePO₄: `3.0` |
| `maxCellVoltage` | float | `3.55` | Voltage mapped to 100 % liquid fill (cell appears full). LiFePO₄: `3.45`–`3.55` |
| `lowVoltageThreshold` | float | `3.1` | Below this voltage the cell liquid turns blood-red |
| `staleTimeout` | integer | `15` | **Seconds** without any entity change before the card shows "inactive" state. Increase to `60`–`120` if your BMS only sends updates when values change |
| `autoResetEnabled` | boolean | `false` | Cross-device default: `true` activates AUTO reset on every browser that has no local override yet |
| `autoResetPeriod` | string | `daily` | `daily` \| `weekly` \| `monthly` — effective only when `autoResetEnabled: true` |
| `waveSpeed` | float | `0.009` | Liquid wave scroll speed in px/ms. Range: `0.005`–`0.015` |
| `waveSpeedVariation` | float | auto | `0`–`1`. Per-cell speed spread. `0` = uniform, `1` = maximum variation |
| `waveReverseRatio` | float | `0.0` | `0`–`1`. Fraction of cells scrolling in the opposite direction |
| `maxFlowPower` | integer | `800` | Watts at which the flow animation runs at maximum speed |

---

### `entities` mapping

All entities are **optional**. Sections with no entities configured are automatically hidden.

#### Core

| Key | Unit | Description |
|---|---|---|
| `state_of_charge` | % | SOC — drives the arc gauge and all percentage displays |
| `total_voltage` | V | Pack voltage shown in the Voltage stat tile |
| `current` | A | Pack current. Positive = charging, negative = discharging |
| `power` | W | Battery power — used to derive charger/load wattage and set flow speed |
| `capacity_remaining` | Ah | Remaining capacity shown inside the gauge and the Remaining tile |
| `average_cell_voltage` | V | Used to calculate per-cell deviation shown below each 3-D cell |

#### Individual cells

| Key | Description |
|---|---|
| `cell_voltage_1` … `cell_voltage_N` | One entry per cell, count must match `cellCount`. Liquid level reflects voltage relative to `minCellVoltage` / `maxCellVoltage` |
| `delta_cell_voltage` | Max − min spread across all cells. Shown as the **ΔV** badge. Orange > 20 mV, red > 50 mV |
| `min_voltage_cell` | Lowest cell — red **▼** marker and red glow border |
| `max_voltage_cell` | Highest cell — green **▲** marker and green glow border |

#### Temperature

| Key | Description |
|---|---|
| `temperature_sensor_1` … `temperature_sensor_4` | Battery temperature probes. Green ≤ 40 °C, red if > 40 °C or < 6 °C |
| `power_tube_temperature` | MOSFET / power-tube temperature. Green ≤ 60 °C, red above |

#### Switches & binary sensors

| Key | Description |
|---|---|
| `charging` | `switch.*` — tapping the **Charge** chip toggles this |
| `discharging` | `switch.*` — tapping the **Discharge** chip toggles this |
| `balancer` | `binary_sensor.*` — `on` lights the purple **Balance** indicator |
| `charging_mosfet_state` | `binary_sensor.*` — `on` = CHG FET conducting (amber); `off` = tripped (red) |
| `discharging_mosfet_state` | `binary_sensor.*` — `on` = DIS FET conducting (violet); `off` = tripped (red) |
| `time_left` | `sensor.*` — decimal hours to full/empty. Auto-formatted: `3h 20m`, `1d 4h` |

#### Energy counters & reset

| Key | Description |
|---|---|
| `energy_in` | kWh — cumulative energy into the battery since last reset |
| `energy_out` | kWh — cumulative energy out of the battery since last reset |
| `energy_clear_btn` | `button.*` — HA button that clears the BMS energy counters. **Required** for both Manual Reset and Auto Reset to work |

#### Battery statistics

| Key | Description |
|---|---|
| `charging_cycles` | Integer — total charge cycles completed |
| `total_runtime_formatted` | Decimal days — total BMS uptime. Auto-formatted: `23d 4h` |
| `total_battery_capacity_setting` | Ah — nominal capacity stored in the BMS |
| `total_charging_cycle_capacity` | Ah — cumulative capacity cycled through the battery |
| `errors` | String — BMS alarm message. Any value other than `normal`, `none`, `ok`, `0` or empty triggers the red alert bar |

---

## Auto Reset — how it works

The energy counter auto-reset runs entirely in the card — **no HA automations, scripts or helpers required**.

### Setup

1. Select a period from the dropdown: **Daily (00:00)**, **Weekly (Mon 00:00)** or **Monthly (1st 00:00)**.
2. Press **AUTO** — the button highlights in blue to confirm it is active.
3. On each HA state update the card checks whether the reset threshold has been crossed. If yes, it presses the `energy_clear_btn` entity and records the timestamp.

### Cross-device sync

The AUTO state (on/off + selected period) is saved to **HA's server-side per-user storage** so it is shared across every browser and device logged in as the same user. Priority order:

1. **HA server** (`frontend/get_user_data`) — loaded ~100–200 ms after page open; overrides everything
2. **localStorage** — instant paint on first render, refreshed from HA server each load
3. **YAML config** (`autoResetEnabled` / `autoResetPeriod`) — device-agnostic default for new devices that have no stored state yet

### Activation timing

When AUTO is first enabled, the last-reset timestamp is seeded to the current time. This means the first reset fires at the **next** threshold (e.g. next midnight), never immediately.

> **Note:** The actual BMS reset fires only while a browser has the dashboard open. For a guaranteed midnight reset regardless of browser state, use a HA automation in addition to or instead of this feature.

---

## Manual Reset — long-press

1. Press and **hold** the **⟳ Manual Reset** button.
2. A red fill bar sweeps from left to right over 2 seconds.
3. **Release early** at any point to cancel — the fill collapses instantly.
4. **Hold the full 2 seconds** — the reset fires and the button flashes green briefly.

This prevents accidental resets from a quick tap.

---

## Connection health / stale detection

| Condition | What you see |
|---|---|
| Data arriving normally | Green pulsing dot · "Live" · coloured gauge |
| No entity change for `staleTimeout` seconds | Red blinking dot · "Connection Lost" · gauge goes greyscale · flow dims to 40 % · status bar shows "No data" · accent bar turns static grey |
| Data resumes | All effects revert within one update cycle |

**Tip:** If your battery sits idle for long periods (stable SOC, no current), entities may genuinely not change. Set `staleTimeout: 60` or higher to avoid false "connection lost" alerts.

---

## Responsive layout

The card uses CSS **container queries** and adapts to its rendered pixel width in five tiers:

| Card width | Layout |
|---|---|
| < 340 px | Hero stacked · 160 px gauge · chips single-column |
| 340–479 px | Hero stacked · 185 px gauge · Charge/Discharge side-by-side · Balance full-width row |
| 480–639 px | Hero side-by-side · 195 px gauge · 3-column chips |
| 640–899 px | Hero side-by-side · 220 px gauge · enlarged flow icons |
| ≥ 900 px | Full desktop layout · 250 px gauge · maximum spacing |

Adjust `grid_options.columns` to make the card wider or narrower on your dashboard.

---

## Troubleshooting

**Card not appearing / "Custom element doesn't exist"**  
→ Verify `/config/www/bms-battery-card-v5.js` exists and the resource `/local/bms-battery-card-v5.js` is registered as a JavaScript module.  
→ Hard-refresh: **Ctrl + Shift + R** (or clear browser cache).

**Gauge is grey immediately after loading**  
→ Check that your entities exist and return numeric values in Developer Tools → States.  
→ If the BMS updates slowly, increase `staleTimeout` (e.g. `60` or `120`).

**AUTO reset state not syncing to another device**  
→ Ensure both devices are logged in as the **same HA user** — the state is stored per user.  
→ Check the browser console for `frontend/get_user_data` errors on older HA versions; fall back to setting `autoResetEnabled: true` in YAML instead.

**Auto reset fires immediately when I press AUTO**  
→ This should not happen in v5 — activation seeds the last-reset timestamp to "now". If it does, check that your HA clock is correct.

**Manual reset button does nothing on a quick tap**  
→ This is intentional — hold for the full 2 seconds to confirm the reset.

**Flow animation looks stuck after switching tabs**  
→ Switch away and back once — the visibility handler resets the animation timer on return. If it persists, do a full page reload.

**Cell liquid level looks wrong**  
→ Verify `minCellVoltage` and `maxCellVoltage` match your battery chemistry.  
→ For LiFePO₄ a typical range is `minCellVoltage: 3.0` / `maxCellVoltage: 3.45`.

---

## Changelog

### v5
- `staleTimeout` now configured in **seconds** in YAML (default 15 s; v4 was a hard-coded 10 min)
- **⚡ CHARGING** badge — blue glowing corner overlay while charging
- **Auto Reset** — daily / weekly / monthly schedule with cross-device sync via HA server storage
- **Manual Reset** — long-press (2 s) with animated fill bar; prevents accidental resets
- **Flow animation fix** — generation counter + `visibilitychange` listener prevent stuck orbs
- **5-tier responsive layout** — CSS container queries; Balance chip no longer overlaps on narrow screens
- MOSFET chips restyled to match stat tiles for visual alignment

### v4
- 3-D volumetric cell tubes with animated wave surface
- Comet-trail power flow animation
- Glassmorphism dark UI with animated gradient accent bar
- MOSFET state chips
- Per-cell min / max glow markers and ΔV badge

---

## License

MIT — free to use, modify and distribute.
