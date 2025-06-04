import Foundation
import Capacitor
import CoreBluetooth
import NetworkExtension
import Network

/// OmniTransfer Capacitor plugin for iOS.
///
/// Provides BLE advertising/scanning via CoreBluetooth and local network
/// discovery via NWBrowser (iOS 14+). Wi-Fi hotspot configuration uses
/// NEHotspotConfigurationManager (iOS 13+, requires NetworkExtension entitlement).
@objc(OmniTransferPlugin)
public class OmniTransferPlugin: CAPPlugin, CBCentralManagerDelegate, CBPeripheralManagerDelegate {

    // MARK: - Constants

    private let serviceUUID = CBUUID(string: "FE55")
    private let manufacturerID: UInt16 = 0x4F54

    // MARK: - State

    private var centralManager: CBCentralManager!
    private var peripheralManager: CBPeripheralManager!
    private var discoveredPeers: [String: [String: Any]] = [:]
    private var scanCall: CAPPluginCall?
    private var scanTimer: Timer?
    private var browser: Any? // NWBrowser — typed as Any for iOS 13 compatibility

    // MARK: - Lifecycle

    public override func load() {
        centralManager = CBCentralManager(delegate: self, queue: nil)
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }

    // MARK: - BLE Scan

    @objc func startScan(_ call: CAPPluginCall) {
        guard centralManager.state == .poweredOn else {
            call.reject("Bluetooth is not powered on")
            return
        }

        discoveredPeers.removeAll()
        scanCall = call

        centralManager.scanForPeripherals(
            withServices: [serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )

        // Return results after 10 s
        scanTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
            self?.centralManager.stopScan()
            var result = self?.discoveredPeers.values.map { $0 } ?? []
            call.resolve(["peers": result])
        }
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        centralManager.stopScan()
        scanTimer?.invalidate()
        call.resolve()
    }

    // CBCentralManagerDelegate

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            notifyListeners("bluetoothStateChange", data: ["state": "poweredOn"])
        case .poweredOff:
            notifyListeners("bluetoothStateChange", data: ["state": "poweredOff"])
        default:
            break
        }
    }

    public func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        let id = peripheral.identifier.uuidString
        let name = peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "Unknown"

        var peer: [String: Any] = [
            "id": id,
            "name": name,
            "rssi": RSSI.intValue,
        ]

        // Parse OmniTransfer manufacturer data
        if let manufData = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
           manufData.count >= 3 {
            // First 2 bytes = manufacturer ID (little-endian), 3rd byte = protocol version
            let mfid = UInt16(manufData[0]) | (UInt16(manufData[1]) << 8)
            if mfid == manufacturerID {
                peer["version"] = Int(manufData[2])
            }
        }

        discoveredPeers[id] = peer
        notifyListeners("peerDiscovered", data: ["peer": peer])
    }

    // MARK: - BLE Advertise

    @objc func startAdvertise(_ call: CAPPluginCall) {
        guard peripheralManager.state == .poweredOn else {
            call.reject("Bluetooth peripheral not powered on")
            return
        }

        let deviceName = call.getString("deviceName") ?? UIDevice.current.name

        // Manufacturer data: [manufacturer_id_lo, manufacturer_id_hi, version]
        var manufBytes: [UInt8] = [
            UInt8(manufacturerID & 0xFF),
            UInt8(manufacturerID >> 8),
            0x01  // protocol version 1
        ]
        let manufData = Data(manufBytes)

        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [serviceUUID],
            CBAdvertisementDataLocalNameKey: deviceName,
            CBAdvertisementDataManufacturerDataKey: manufData
        ])

        call.resolve()
    }

    @objc func stopAdvertise(_ call: CAPPluginCall) {
        peripheralManager.stopAdvertising()
        call.resolve()
    }

    // CBPeripheralManagerDelegate

    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        // Handled in startAdvertise
    }

    public func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            notifyListeners("advertisingFailed", data: ["error": error.localizedDescription])
        } else {
            notifyListeners("advertisingStarted", data: ["status": "advertising"])
        }
    }

    // MARK: - Wi-Fi Hotspot (NEHotspotConfiguration)

    @objc func startHotspot(_ call: CAPPluginCall) {
        // NEHotspotConfigurationManager requires the NetworkExtension entitlement
        // and com.apple.developer.networking.networkextension = ["hotspot-manager"].
        // Only available in production builds with proper provisioning profile.

        guard #available(iOS 13.0, *) else {
            call.reject("Hotspot configuration requires iOS 13+")
            return
        }

        let ssid = call.getString("ssid") ?? "OmniTransfer"
        let passphrase = call.getString("passphrase") ?? "omni12345"

        let config = NEHotspotConfiguration(ssidPrefix: ssid, passphrase: passphrase, isWEP: false)
        config.joinOnce = true

        NEHotspotConfigurationManager.shared.apply(config) { error in
            if let error = error {
                // Ignore "already connected" pseudo-error
                let nsError = error as NSError
                if nsError.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    call.resolve(["ssid": ssid])
                } else {
                    call.reject("Hotspot apply failed: \(error.localizedDescription)")
                }
            } else {
                call.resolve(["ssid": ssid])
            }
        }
    }

    @objc func stopHotspot(_ call: CAPPluginCall) {
        // There's no programmatic teardown for NEHotspotConfiguration from within an app;
        // the system removes the config when joinOnce=true and the app is no longer in use.
        call.resolve()
    }

    // MARK: - Local Network Discovery (iOS 14+)

    @available(iOS 14.0, *)
    @objc func startNetworkDiscovery(_ call: CAPPluginCall) {
        let params = NWParameters.tcp
        params.includePeerToPeer = true

        let desc = NWBrowserDescriptor.bonjourWithTXTRecord(
            type: "_omnitransfer._tcp",
            domain: "local."
        )
        let b = NWBrowser(for: desc, using: params)
        browser = b

        b.browseResultsChangedHandler = { [weak self] results, _ in
            for result in results {
                if case .service(let name, _, _, _) = result.endpoint {
                    let peer: [String: Any] = [
                        "id": name,
                        "name": name,
                        "transport": "mdns",
                    ]
                    self?.notifyListeners("peerDiscovered", data: ["peer": peer])
                }
            }
        }

        b.start(queue: .main)
        call.resolve()
    }
}
