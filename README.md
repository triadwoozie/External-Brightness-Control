# External Monitor Control (GNOME Shell Extension)

[![GNOME Shell 45-51](https://img.shields.io/badge/GNOME-45%20--%2051-blue.svg)](https://gitlab.gnome.org/GNOME/gnome-shell)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A clean, responsive, and lightweight GNOME Shell extension designed to control external DDC/CI monitors (such as Lenovo, Dell, LG, ASUS, Samsung, and others connected via HDMI, DisplayPort, or USB-C).

Unlike legacy extensions that hammer the I2C bus synchronously and freeze the desktop, **External Monitor Control** uses a serialized asynchronous worker with debounced DDC/CI commands, native vanilla GNOME theming, and automatic hardware-lock unlocking.

---

## 🌟 Key Features

* **Instant Brightness & Contrast Control:** Smooth slider adjustments over VCP `0x10` and `0x12`.
* **Hardware Preset Switching:** One-click color preset selection:
  * sRGB (Factory Calibrated)
  * Warm (6500 K)
  * Neutral (7500 K)
  * Cool (9300 K)
  * Custom / User 1 (Fully Unlocked)
* **RGB Gain Tuning:** Fine-grained color temperature balancing with independent Red, Green, and Blue sliders (VCP `0x16`, `0x18`, `0x1A`).
* **Auto-Unlock for sRGB:** Factory sRGB modes in monitor firmware lock contrast and RGB gains. This extension automatically switches the monitor to *User 1 (Custom)* when adjusting contrast or color gain so changes take effect immediately.
* **Monitor Speaker / Audio Volume:** Hardware audio control over VCP `0x62` for monitors with integrated speakers or 3.5mm headphone passthrough jacks.
* **Input Source Selection:** Toggle between HDMI-1 and Alternate / Type-C inputs directly from the panel.
* **Power Management:** Send DPM/DPMS Standby (`0x04`) or Wake/Power On (`0x01`) commands directly over DDC.
* **Automatic Bus Detection:** Automatically isolates the external monitor's I2C bus and ignores internal laptop panels (`eDP-1`), preventing I2C timeouts in system logs.

---

## 🚀 Performance & Architecture

* **Serialized Asynchronous Queue:** DDC/CI uses a slow serial I2C bus (~100 kHz). Running parallel commands results in bus collision and dropped commands. This extension guarantees strictly serialized command execution.
* **Zero UI Lag (`--noverify`):** Eliminates redundant round-trip verification queries during slider moves, cutting command latency from ~300ms down to ~35ms.
* **Debounced Sliders:** Prevents flooding the monitor EEPROM with hundreds of micro-adjustments while dragging.
* **Native GNOME Theming:** Uses GNOME Shell's built-in `PanelMenu.Button`, `St.BoxLayout`, and `Slider.Slider` components for an authentic, consistent look.

---

## 📦 Installation

### Prerequisites
Make sure `ddcutil` is installed and your user account has access to I2C devices:
```bash
# Fedora / Nobara:
sudo dnf install ddcutil

# Arch Linux:
sudo pacman -S ddcutil

# Ubuntu / Debian:
sudo apt install ddcutil
```

Ensure your user is in the `i2c` / `video` group, or that udev ACL rules are active:
```bash
# Verify permissions (should return without sudo):
ddcutil detect --brief
```

### Manual Install
1. Clone the repository into your GNOME extensions folder:
```bash
mkdir -p ~/.local/share/gnome-shell/extensions/
git clone https://github.com/triadwoozie/External-Brightness-Control.git ~/.local/share/gnome-shell/extensions/monitor-control@triadwoozie.github.com
```

2. Enable the extension:
```bash
gnome-extensions enable monitor-control@triadwoozie.github.com
```
*(On Wayland, restart your session or log out/in to reload newly added extensions).*

---

## 🛠️ Accompanying CLI Helper

Included in the repository is `monitor-ctl.sh` for fast terminal control or mapping to custom keyboard shortcuts:

```bash
# View current monitor VCP state:
./monitor-ctl.sh status

# Set Brightness (0-100):
./monitor-ctl.sh brightness 80

# Set Contrast (0-100):
./monitor-ctl.sh contrast 75

# Change Color Preset:
./monitor-ctl.sh preset warm    # Options: srgb, warm, neutral, cool, user

# Adjust RGB Balance:
./monitor-ctl.sh rgb 100 95 90

# Put monitor into Standby:
./monitor-ctl.sh standby
```

---

## 📄 License
MIT License. Created by [triadwoozie](https://github.com/triadwoozie).
