package com.omnitransfer;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.net.wifi.WifiNetworkSuggestion;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;

import androidx.annotation.RequiresApi;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * OmniTransfer Capacitor plugin for Android.
 *
 * Exposes BLE advertising/scanning and local-only Wi-Fi hotspot management
 * to the web layer. Full Java implementation — does not depend on any
 * third-party BLE or Wi-Fi Capacitor plugins.
 */
@CapacitorPlugin(
    name = "OmniTransfer",
    permissions = {
        @Permission(strings = {
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_ADVERTISE,
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.ACCESS_FINE_LOCATION
        }, alias = "ble"),
        @Permission(strings = {
            Manifest.permission.ACCESS_WIFI_STATE,
            Manifest.permission.CHANGE_WIFI_STATE,
            Manifest.permission.CHANGE_NETWORK_STATE
        }, alias = "wifi")
    }
)
public class OmniTransferPlugin extends Plugin {

    private static final String SERVICE_UUID = "0000FE55-0000-1000-8000-00805F9B34FB";

    private BluetoothLeScanner bleScanner;
    private BluetoothLeAdvertiser bleAdvertiser;
    private WifiManager.LocalOnlyHotspotReservation hotspotReservation;
    private final List<JSObject> discoveredPeers = Collections.synchronizedList(new ArrayList<>());

    // ─── BLE Scan ────────────────────────────────────────────────────────────

    @PluginMethod
    public void startScan(PluginCall call) {
        if (!requestPermissionsIfNeeded("ble", call)) return;

        BluetoothManager btm = (BluetoothManager)
            getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (btm == null || btm.getAdapter() == null) {
            call.reject("Bluetooth not available");
            return;
        }
        bleScanner = btm.getAdapter().getBluetoothLeScanner();
        if (bleScanner == null) {
            call.reject("BLE scanner not available");
            return;
        }

        discoveredPeers.clear();

        ScanFilter filter = new ScanFilter.Builder()
            .setServiceUuid(ParcelUuid.fromString(SERVICE_UUID))
            .build();

        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build();

        bleScanner.startScan(
            Collections.singletonList(filter),
            settings,
            scanCallback
        );

        // Stop scan after 10 s and return results
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            bleScanner.stopScan(scanCallback);
            JSObject result = new JSObject();
            JSArray peers = new JSArray();
            synchronized (discoveredPeers) {
                for (JSObject p : discoveredPeers) {
                    peers.put(p);
                }
            }
            result.put("peers", peers);
            call.resolve(result);
        }, 10_000);
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            ScanRecord record = result.getScanRecord();

            JSObject peer = new JSObject();
            peer.put("id", device.getAddress());
            peer.put("name", device.getName() != null ? device.getName() : "Unknown");
            peer.put("rssi", result.getRssi());

            // Parse OmniTransfer manufacturer data if present
            if (record != null) {
                byte[] manuf = record.getManufacturerSpecificData(0x4F54); // "OT"
                if (manuf != null && manuf.length > 0) {
                    peer.put("version", manuf[0] & 0xFF);
                }
            }

            discoveredPeers.add(peer);

            // Notify the web layer of each discovered device in real time
            JSObject event = new JSObject();
            event.put("peer", peer);
            notifyListeners("peerDiscovered", event);
        }
    };

    // ─── BLE Advertise ───────────────────────────────────────────────────────

    @PluginMethod
    public void startAdvertise(PluginCall call) {
        if (!requestPermissionsIfNeeded("ble", call)) return;

        BluetoothManager btm = (BluetoothManager)
            getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (btm == null) {
            call.reject("Bluetooth not available");
            return;
        }
        bleAdvertiser = btm.getAdapter().getBluetoothLeAdvertiser();
        if (bleAdvertiser == null) {
            call.reject("BLE advertiser not available (not supported on this device)");
            return;
        }

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build();

        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid.fromString(SERVICE_UUID))
            .addManufacturerData(0x4F54, new byte[]{0x01}) // version = 1
            .build();

        bleAdvertiser.startAdvertising(settings, data, advertiseCallback);
        call.resolve();
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            JSObject event = new JSObject();
            event.put("status", "advertising");
            notifyListeners("advertisingStarted", event);
        }

        @Override
        public void onStartFailure(int errorCode) {
            JSObject event = new JSObject();
            event.put("error", "Advertise failed: " + errorCode);
            notifyListeners("advertisingFailed", event);
        }
    };

    @PluginMethod
    public void stopAdvertise(PluginCall call) {
        if (bleAdvertiser != null) {
            bleAdvertiser.stopAdvertising(advertiseCallback);
        }
        call.resolve();
    }

    // ─── Wi-Fi Local-Only Hotspot ─────────────────────────────────────────────

    @PluginMethod
    @RequiresApi(api = Build.VERSION_CODES.O)
    public void startHotspot(PluginCall call) {
        if (!requestPermissionsIfNeeded("wifi", call)) return;

        WifiManager wifiManager = (WifiManager)
            getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);

        if (wifiManager == null) {
            call.reject("WifiManager not available");
            return;
        }

        wifiManager.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
            @Override
            public void onStarted(WifiManager.LocalOnlyHotspotReservation reservation) {
                hotspotReservation = reservation;
                JSObject result = new JSObject();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // Android 11+: access SoftApConfiguration
                    result.put("ssid", "OmniTransfer");
                } else {
                    // Android 8-10: access WifiConfiguration
                    result.put("ssid", reservation.getWifiConfiguration() != null
                        ? reservation.getWifiConfiguration().SSID
                        : "OmniTransfer");
                }
                call.resolve(result);
            }

            @Override
            public void onFailed(int reason) {
                call.reject("Hotspot start failed: reason=" + reason);
            }
        }, new Handler(Looper.getMainLooper()));
    }

    @PluginMethod
    public void stopHotspot(PluginCall call) {
        if (hotspotReservation != null) {
            hotspotReservation.close();
            hotspotReservation = null;
        }
        call.resolve();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private boolean requestPermissionsIfNeeded(String alias, PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestPermissionForAlias(alias, call, "permissionsCallback");
            return false;
        }
        return true;
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        if (hasRequiredPermissions()) {
            // Re-invoke the method
        } else {
            call.reject("Permissions not granted");
        }
    }
}
