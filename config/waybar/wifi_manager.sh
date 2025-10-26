#!/bin/bash

# WiFi Manager Script for Waybar using iwd
# Provides interactive WiFi network selection and management

# Colors for notifications
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
INTERFACE="wlan0"
ROFI_THEME="~/.config/rofi/config.rasi"

# Function to get WiFi status for Waybar JSON output
get_wifi_status() {
    local status=$(iwctl station $INTERFACE show 2>/dev/null | grep "State" | awk '{print $2}')
    local ssid=$(iwctl station $INTERFACE show 2>/dev/null | grep "Connected network" | cut -d' ' -f3-)
    local signal=$(iwctl station $INTERFACE show 2>/dev/null | grep "RSSI" | awk '{print $2}' | tr -d ' ')
    
    # Convert signal strength to quality percentage
    local quality=0
    if [[ $signal =~ ^-[0-9]+$ ]]; then
        # Convert RSSI to quality (rough approximation)
        # -30 dBm = 100%, -90 dBm = 0%
        quality=$(( 100 - ((-signal + 30) * 100 / 60) ))
        [[ $quality -lt 0 ]] && quality=0
        [[ $quality -gt 100 ]] && quality=100
    fi
    
    # Determine icon based on signal strength and status
    local icon=""
    local class="disconnected"
    local text=""
    local tooltip="WiFi: Disconnected\nClick to scan and connect"
    
    case $status in
        "connected")
            class="connected"
            tooltip="WiFi: Connected to $ssid\nSignal: $signal ($quality%)\nClick to manage networks"
            
            if [[ $quality -ge 75 ]]; then
                icon="󰤨"  # Full signal
            elif [[ $quality -ge 50 ]]; then
                icon="󰤥"  # Good signal
            elif [[ $quality -ge 25 ]]; then
                icon="󰤢"  # Fair signal
            else
                icon="󰤟"  # Poor signal
            fi
            text="$icon"
            ;;
        "connecting")
            class="connecting"
            icon="󰤩"
            text="$icon"
            tooltip="WiFi: Connecting...\nPlease wait"
            ;;
        "disconnected"|*)
            class="disconnected"
            icon="󰤭"
            text="$icon"
            tooltip="WiFi: Disconnected\nClick to scan and connect"
            ;;
    esac
    
    echo "{\"text\": \"$text\", \"class\": \"$class\", \"tooltip\": \"$tooltip\"}"
}

# Function to scan for networks
scan_networks() {
    echo "Scanning for networks..." >&2
    iwctl station $INTERFACE scan
    sleep 2
    iwctl station $INTERFACE get-networks | tail -n +5 | head -n -1 | awk '{for(i=1;i<=NF-3;i++) printf "%s ", $i; print ""}'
}

# Function to show network selection menu
show_network_menu() {
    local networks=$(scan_networks)
    
    if [ -z "$networks" ]; then
        notify-send "WiFi" "No networks found" -i network-wireless
        return 1
    fi
    
    # Add special options
    local menu_options=$(printf "%s\n%s\n%s\n%s" "🔄 Refresh Networks" "📊 Show Current Status" "❌ Disconnect" "$networks")
    
    local selected=$(echo "$menu_options" | rofi -dmenu -i -p "Select WiFi Network:" -theme-str 'listview { lines: 10; }')
    
    case "$selected" in
        "🔄 Refresh Networks")
            show_network_menu
            ;;
        "📊 Show Current Status")
            show_wifi_info
            ;;
        "❌ Disconnect")
            disconnect_wifi
            ;;
        "")
            return 1
            ;;
        *)
            # Remove any leading/trailing whitespace and connect to selected network
            local network=$(echo "$selected" | xargs)
            connect_to_network "$network"
            ;;
    esac
}

# Function to connect to a network
connect_to_network() {
    local network="$1"
    
    if [ -z "$network" ]; then
        return 1
    fi
    
    echo "Connecting to: $network" >&2
    
    # Check if network requires password
    local security=$(iwctl station $INTERFACE get-networks | grep -F "$network" | awk '{print $(NF-1)}')
    
    if [[ "$security" == *"psk"* ]] || [[ "$security" == *"WPA"* ]]; then
        # Network requires password
        local password=$(rofi -dmenu -password -p "Enter password for $network:")
        
        if [ -z "$password" ]; then
            notify-send "WiFi" "Connection cancelled" -i network-wireless
            return 1
        fi
        
        # Connect with password
        echo "Connecting to secured network..." >&2
        if iwctl station $INTERFACE connect "$network" --passphrase "$password"; then
            notify-send "WiFi" "Successfully connected to $network" -i network-wireless
        else
            notify-send "WiFi" "Failed to connect to $network" -i network-error
        fi
    else
        # Open network
        echo "Connecting to open network..." >&2
        if iwctl station $INTERFACE connect "$network"; then
            notify-send "WiFi" "Successfully connected to $network" -i network-wireless
        else
            notify-send "WiFi" "Failed to connect to $network" -i network-error
        fi
    fi
}

# Function to disconnect WiFi
disconnect_wifi() {
    local current_ssid=$(iwctl station $INTERFACE show | grep "Connected network" | cut -d' ' -f3-)
    
    if [ -n "$current_ssid" ]; then
        iwctl station $INTERFACE disconnect
        notify-send "WiFi" "Disconnected from $current_ssid" -i network-wireless-disconnected
    else
        notify-send "WiFi" "Not connected to any network" -i network-wireless
    fi
}

# Function to show WiFi info
show_wifi_info() {
    local info=$(iwctl station $INTERFACE show 2>/dev/null)
    local formatted_info=$(echo "$info" | grep -E "(State|Connected network|IPv4 address|Security|RSSI|Channel)" | sed 's/^[[:space:]]*//')
    
    if [ -n "$formatted_info" ]; then
        echo "$formatted_info" | rofi -dmenu -p "WiFi Information:" -no-custom -theme-str 'listview { lines: 6; }'
    else
        echo "No WiFi information available" | rofi -dmenu -p "WiFi Information:" -no-custom
    fi
}

# Function to toggle WiFi
toggle_wifi() {
    local device_status=$(iwctl device list | grep $INTERFACE | awk '{print $3}')
    
    case "$device_status" in
        "on")
            iwctl device $INTERFACE set-property Powered off
            notify-send "WiFi" "WiFi disabled" -i network-wireless-disabled
            ;;
        "off")
            iwctl device $INTERFACE set-property Powered on
            sleep 2
            notify-send "WiFi" "WiFi enabled" -i network-wireless
            ;;
        *)
            notify-send "WiFi" "Unable to determine WiFi status" -i network-error
            ;;
    esac
}

# Function to fix WiFi auto-reconnection issues
fix_wifi_reconnection() {
    echo "Fixing WiFi auto-reconnection..." >&2
    
    # Enable iwd auto-connection feature
    sudo mkdir -p /etc/iwd
    
    # Create or update main.conf
    cat > /tmp/iwd_main.conf << EOF
[General]
EnableNetworkConfiguration=true
APRanges=true
AutoConnect=true

[Network]
EnableIPv6=true
RoutePriorityOffset=300

[Scan]
InitialPeriodicScanInterval=10
MaxPeriodicScanInterval=300
EOF

    if sudo cp /tmp/iwd_main.conf /etc/iwd/main.conf; then
        # Restart iwd service
        sudo systemctl restart iwd
        notify-send "WiFi" "WiFi auto-reconnection fixed. Reboot recommended." -i network-wireless
        echo "Auto-reconnection settings applied successfully" >&2
    else
        notify-send "WiFi" "Failed to apply auto-reconnection fix" -i network-error
        echo "Failed to apply settings" >&2
    fi
    
    rm -f /tmp/iwd_main.conf
}

# Main execution
case "$1" in
    "status")
        get_wifi_status
        ;;
    "menu")
        show_network_menu
        ;;
    "toggle")
        toggle_wifi
        ;;
    "disconnect")
        disconnect_wifi
        ;;
    "info")
        show_wifi_info
        ;;
    "fix")
        fix_wifi_reconnection
        ;;
    "scan")
        iwctl station $INTERFACE scan
        sleep 2
        scan_networks
        ;;
    *)
        echo "Usage: $0 {status|menu|toggle|disconnect|info|fix|scan}"
        echo "  status    - Get WiFi status for Waybar"
        echo "  menu      - Show network selection menu"
        echo "  toggle    - Toggle WiFi on/off"
        echo "  disconnect- Disconnect from current network"
        echo "  info      - Show detailed WiFi information"
        echo "  fix       - Fix auto-reconnection issues"
        echo "  scan      - Scan for available networks"
        exit 1
        ;;
esac