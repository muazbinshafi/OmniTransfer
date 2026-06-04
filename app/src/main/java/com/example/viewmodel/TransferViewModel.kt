package com.example.viewmodel

import android.app.Application
import android.net.Uri
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.transfer.NsdHelper
import com.example.transfer.PeerDevice
import com.example.transfer.TransferManager
import kotlinx.coroutines.launch

import com.example.transfer.NetworkManagerHelper
import com.example.transfer.WebServerManager

class TransferViewModel(application: Application) : AndroidViewModel(application) {
    private val nsdHelper = NsdHelper(application)
    private val transferManager = TransferManager(application)
    val networkHelper = NetworkManagerHelper(application)
    private val webServer = WebServerManager(application)
    
    val peers = nsdHelper.peers
    val transferInfo = transferManager.transferInfo
    val networkInfo = networkHelper.networkInfo
    
    var webServerPort: Int = 8080
        private set

    init {
        // Start Server 
        val port = transferManager.startServer()
        if (port != -1) {
            val deviceModel = Build.MODEL
            nsdHelper.registerService(port, deviceModel)
            nsdHelper.discoverServices()
        }
        
        webServerPort = webServer.start()
    }

    fun sendFile(peer: PeerDevice, uri: Uri) {
        viewModelScope.launch {
            transferManager.sendFile(peer, uri)
        }
    }
    
    fun resetTransferState() {
        transferManager.resetState()
    }

    override fun onCleared() {
        super.onCleared()
        nsdHelper.stop()
        transferManager.stopServer()
    }
}
