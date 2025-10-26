#!/bin/bash

# Bluetooth status script for Waybar
# Provides real-time connection status and device information

get_bluetooth_status() {
    # Check if Bluetooth service is running
    if ! systemctl --user is-active --quiet bluetooth 2>/dev/null && ! systemctl is-active --quiet bluetooth 2>/dev/null; then
        echo '{"text": "󰂲", "class": "disabled", "tooltip": "Bluetooth service is not running"}'
        return
    fi

    # Check if Bluetooth is powered on
    if ! bluetoothctl show | grep -q "Powered: yes"; then
        echo '{"text": "󰂲", "class": "disabled", "tooltip": "Bluetooth is powered off\nClick to turn on"}'
        return
    fi

    # Get connected devices
    connected_devices=$(bluetoothctl devices Connected 2>/dev/null)
    device_count=$(echo "$connected_devices" | grep -c "Device" 2>/dev/null || echo "0")

    # Check if discovering
    if bluetoothctl show | grep -q "Discovering: yes"; then
        echo '{"text": "󰂰", "class": "discovering", "tooltip": "Bluetooth is discovering devices..."}'
        return
    fi

    # Build tooltip with device information
    tooltip="Bluetooth: ON"
    if [ "$device_count" -gt 0 ]; then
        tooltip="$tooltip\nConnected devices ($device_count):\n"
        while IFS= read -r line; do
            if [[ $line == *"Device"* ]]; then
                device_mac=$(echo "$line" | awk '{print $2}')
                device_name=$(echo "$line" | cut -d' ' -f3-)
                
                # Get battery level if available
                battery_info=$(bluetoothctl info "$device_mac" 2>/dev/null | grep "Battery Percentage" | awk '{print $4}' | tr -d '()')
                if [ -n "$battery_info" ]; then
                    tooltip="$tooltip• $device_name ($battery_info%)\n"
                else
                    tooltip="$tooltip• $device_name\n"
                fi
            fi
        done <<< "$connected_devices"
        
        # Show connected icon with device count
        if [ "$device_count" -eq 1 ]; then
            # Single device - try to show battery if available
            first_device_mac=$(echo "$connected_devices" | head -n1 | awk '{print $2}')
            battery_level=$(bluetoothctl info "$first_device_mac" 2>/dev/null | grep "Battery Percentage" | awk '{print $4}' | tr -d '()')
            if [ -n "$battery_level" ]; then
                echo "{\"text\": \"󰂱 $battery_level%\", \"class\": \"connected\", \"tooltip\": \"$(echo -e "$tooltip")\"}"
            else
                echo "{\"text\": \"󰂱 $device_count\", \"class\": \"connected\", \"tooltip\": \"$(echo -e "$tooltip")\"}"
            fi
        else
            echo "{\"text\": \"󰂱 $device_count\", \"class\": \"connected\", \"tooltip\": \"$(echo -e "$tooltip")\"}"
        fi
    else
        tooltip="$tooltip\nNo devices connected"
        echo "{\"text\": \"󰂯\", \"class\": \"enabled\", \"tooltip\": \"$(echo -e "$tooltip")\"}"
    fi
}

# Handle script arguments for control functions
case "$1" in
    "toggle")
        if bluetoothctl show | grep -q "Powered: yes"; then
            bluetoothctl power off
        else
            bluetoothctl power on
        fi
        ;;
    "connect")
        # Open Bluetooth manager
        if command -v blueman-manager >/dev/null; then
            blueman-manager
        elif command -v gnome-control-center >/dev/null; then
            gnome-control-center bluetooth
        else
            # Fallback: scan for devices and show them
            bluetoothctl scan on &
            sleep 2
            bluetoothctl scan off
            bluetoothctl devices | rofi -dmenu -p "Connect to device:" | awk '{print $2}' | xargs bluetoothctl connect
        fi
        ;;
    *)
        get_bluetooth_status
        ;;
esac