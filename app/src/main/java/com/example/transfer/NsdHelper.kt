package com.example.transfer

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.net.InetAddress

data class PeerDevice(val name: String, val host: InetAddress, val port: Int)

class NsdHelper(context: Context) {
    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val serviceType = "_omnitransfer._tcp."
    private var serviceName = "OmniDevice"
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    private val _peers = MutableStateFlow<List<PeerDevice>>(emptyList())
    val peers: StateFlow<List<PeerDevice>> = _peers.asStateFlow()

    fun registerService(port: Int, name: String) {
        serviceName = name
        val serviceInfo = NsdServiceInfo().apply {
            this.serviceName = name
            this.serviceType = this@NsdHelper.serviceType
            this.port = port
        }

        registrationListener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(NsdServiceInfo: NsdServiceInfo) {
                serviceName = NsdServiceInfo.serviceName
                Log.d("NsdHelper", "Registered: $serviceName on port $port")
            }
            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e("NsdHelper", "Registration failed: $errorCode")
            }
            override fun onServiceUnregistered(arg0: NsdServiceInfo) {
                Log.d("NsdHelper", "Unregistered: ${arg0.serviceName}")
            }
            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e("NsdHelper", "Unregistration failed: $errorCode")
            }
        }

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
    }

    fun discoverServices() {
        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d("NsdHelper", "Service discovery started")
            }
            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d("NsdHelper", "Service found: ${service.serviceName}")
                if (service.serviceType == serviceType && service.serviceName != serviceName) {
                    nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                            Log.e("NsdHelper", "Resolve failed: $errorCode")
                        }
                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            Log.d("NsdHelper", "Resolve succeeded: ${serviceInfo.serviceName}")
                            val host = serviceInfo.host
                            val port = serviceInfo.port
                            val name = serviceInfo.serviceName
                            _peers.update { current ->
                                val list = current.toMutableList()
                                list.removeAll { it.name == name }
                                list.add(PeerDevice(name, host, port))
                                list
                            }
                        }
                    })
                }
            }
            override fun onServiceLost(service: NsdServiceInfo) {
                Log.e("NsdHelper", "Service lost: ${service.serviceName}")
                val name = service.serviceName
                _peers.update { current -> current.filter { it.name != name } }
            }
            override fun onDiscoveryStopped(serviceType: String) {
                Log.i("NsdHelper", "Discovery stopped: $serviceType")
            }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e("NsdHelper", "Discovery failed: $errorCode")
                nsdManager.stopServiceDiscovery(this)
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e("NsdHelper", "Stop discovery failed: $errorCode")
                nsdManager.stopServiceDiscovery(this)
            }
        }
        
        try {
            nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            Log.e("NsdHelper", "Error starting discovery", e)
        }
    }

    fun stop() {
        try {
            registrationListener?.let { nsdManager.unregisterService(it) }
        } catch (e: Exception) {}
        try {
            discoveryListener?.let { nsdManager.stopServiceDiscovery(it) }
        } catch (e: Exception) {}
        registrationListener = null
        discoveryListener = null
    }
}
