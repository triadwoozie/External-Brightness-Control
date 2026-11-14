#!/usr/bin/env bash
# Quick CLI Helper for Lenovo L24-4C DDC/CI Monitor
set -e

BUS=7

function usage() {
    echo "Usage: $0 [status | brightness <0-100> | contrast <0-100> | volume <0-100> | preset <srgb|6500|7500|9300|user> | rgb <r> <g> <b> | standby | on]"
    exit 1
}

CMD="$1"
shift || true

case "$CMD" in
    status)
        echo "=== Lenovo L24-4C Current Settings (Bus $BUS) ==="
        ddcutil --bus "$BUS" getvcp 10 12 14 16 18 1A 62 D6
        ;;
    brightness)
        VAL="$1"
        [ -z "$VAL" ] && usage
        ddcutil --bus "$BUS" setvcp 10 "$VAL"
        echo "Brightness set to $VAL%"
        ;;
    contrast)
        VAL="$1"
        [ -z "$VAL" ] && usage
        ddcutil --bus "$BUS" setvcp 12 "$VAL"
        echo "Contrast set to $VAL%"
        ;;
    volume)
        VAL="$1"
        [ -z "$VAL" ] && usage
        ddcutil --bus "$BUS" setvcp 62 "$VAL"
        echo "Volume set to $VAL%"
        ;;
    preset)
        case "$1" in
            srgb) CODE="01" ;;
            6500|warm) CODE="05" ;;
            7500|neutral) CODE="06" ;;
            9300|cool) CODE="08" ;;
            user) CODE="0b" ;;
            *) echo "Unknown preset. Choose: srgb, 6500 (warm), 7500 (neutral), 9300 (cool), user"; exit 1 ;;
        esac
        ddcutil --bus "$BUS" setvcp 14 "0x$CODE"
        echo "Preset applied: $1"
        ;;
    rgb)
        R="$1"; G="$2"; B="$3"
        [ -z "$B" ] && usage
        ddcutil --bus "$BUS" setvcp 16 "$R"
        ddcutil --bus "$BUS" setvcp 18 "$G"
        ddcutil --bus "$BUS" setvcp 1a "$B"
        echo "RGB gain set to R:$R G:$G B:$B"
        ;;
    standby)
        ddcutil --bus "$BUS" setvcp d6 0x04
        echo "Display placed in standby."
        ;;
    on)
        ddcutil --bus "$BUS" setvcp d6 0x01
        echo "Display powered on."
        ;;
    *)
        usage
        ;;
esac
