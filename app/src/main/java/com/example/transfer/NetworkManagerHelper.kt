package com.example.transfer

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address
import java.net.NetworkInterface

data class NetworkInfo(
    val ssid: String = "",
    val password: String? = null,
    val ipAddress: String = "",
    val isHotspot: Boolean = false
)

class NetworkManagerHelper(private val context: Context) {
    private val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private var hotspotReservation: WifiManager.LocalOnlyHotspotReservation? = null

    private val _networkInfo = MutableStateFlow(NetworkInfo(ipAddress = getLocalIpAddress()))
    val networkInfo: StateFlow<NetworkInfo> = _networkInfo.asStateFlow()

    fun updateLocalIp() {
        _networkInfo.value = _networkInfo.value.copy(ipAddress = getLocalIpAddress())
    }

    fun startHotspot(onSuccess: () -> Unit, onFailure: (String) -> Unit) {
        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            onFailure("Location permission required")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && 
            ActivityCompat.checkSelfPermission(context, Manifest.permission.NEARBY_WIFI_DEVICES) != PackageManager.PERMISSION_GRANTED) {
            onFailure("Nearby devices permission required")
            return
        }

        try {
            wifiManager.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(reservation: WifiManager.LocalOnlyHotspotReservation?) {
                    super.onStarted(reservation)
                    hotspotReservation = reservation
                    val config = reservation?.wifiConfiguration
                    val ssid = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        reservation?.softApConfiguration?.ssid
                    } else {
                        config?.SSID
                    }
                    val pass = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        reservation?.softApConfiguration?.passphrase
                    } else {
                        config?.preSharedKey
                    }
                    val ip = getLocalIpAddress()
                    
                    _networkInfo.value = NetworkInfo(
                        ssid = ssid?.replace("\"", "") ?: "Hotspot",
                        password = pass,
                        ipAddress = ip.ifEmpty { "192.168.43.1" }, // fallback android hotspot IP
                        isHotspot = true
                    )
                    Log.d("Hotspot", "Started: $ssid")
                    onSuccess()
                }

                override fun onStopped() {
                    super.onStopped()
                    Log.d("Hotspot", "Stopped")
                    _networkInfo.value = NetworkInfo(ipAddress = getLocalIpAddress())
                }

                override fun onFailed(reason: Int) {
                    super.onFailed(reason)
                    Log.e("Hotspot", "Failed: $reason")
                    onFailure("Error code: $reason")
                }
            }, Handler(Looper.getMainLooper()))
        } catch (e: Exception) {
            Log.e("Hotspot", "Exception starting hotspot", e)
            onFailure(e.message ?: "Unknown error")
        }
    }

    fun stopHotspot() {
        hotspotReservation?.close()
        hotspotReservation = null
        _networkInfo.value = NetworkInfo(ipAddress = getLocalIpAddress())
    }

    private fun getLocalIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                val addresses = networkInterface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (!addr.isLoopbackAddress && addr is Inet4Address) {
                        return addr.hostAddress ?: ""
                    }
                }
            }
        } catch (e: Exception) {
            Log.e("Network", "Error getting IP", e)
        }
        return ""
    }
}
