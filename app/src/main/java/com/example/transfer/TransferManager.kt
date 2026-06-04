package com.example.transfer

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean

enum class TransferState { IDLE, CONNECTING, TRANSFERRING, COMPLETE, ERROR }

data class TransferInfo(
    val state: TransferState = TransferState.IDLE,
    val progress: Float = 0f, // 0.0 to 1.0
    val speedMbps: Float = 0f,
    val operation: String = "" // "Sending" or "Receiving"
)

class TransferManager(private val context: Context) {
    private var serverSocket: ServerSocket? = null
    private val isRunning = AtomicBoolean(false)
    
    private val _transferInfo = MutableStateFlow(TransferInfo())
    val transferInfo: StateFlow<TransferInfo> = _transferInfo.asStateFlow()

    fun startServer(): Int {
        if (serverSocket != null) return serverSocket!!.localPort
        try {
            serverSocket = ServerSocket(0) // Bind to available port
            val port = serverSocket!!.localPort
            isRunning.set(true)
            
            Thread {
                acceptConnections()
            }.start()
            
            return port
        } catch (e: Exception) {
            Log.e("TransferManager", "Server failed to start", e)
            return -1
        }
    }
    
    fun stopServer() {
        isRunning.set(false)
        try {
            serverSocket?.close()
        } catch (e: Exception) {}
        serverSocket = null
    }

    private fun acceptConnections() {
        while (isRunning.get()) {
            try {
                val client = serverSocket?.accept() ?: break
                Thread {
                    receiveFile(client)
                }.start()
            } catch (e: Exception) {
                if (isRunning.get()) Log.e("TransferManager", "Accept error", e)
            }
        }
    }

    private fun receiveFile(socket: Socket) {
        _transferInfo.update { it.copy(state = TransferState.CONNECTING, operation = "Receiving") }
        try {
            socket.use { s ->
                val din = DataInputStream(s.getInputStream())
                
                // Read metadata
                val fileName = din.readUTF()
                val fileSize = din.readLong()
                
                // Set up output path
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) downloadsDir.apply { mkdirs() }
                
                val outputFile = File(downloadsDir, fileName)
                val fos = FileOutputStream(outputFile)
                
                _transferInfo.update { it.copy(state = TransferState.TRANSFERRING) }
                
                // Read data
                val buffer = ByteArray(8192)
                var totalRead: Long = 0
                var read: Int
                
                val startTime = System.currentTimeMillis()
                var lastUpdateTime = startTime
                var bytesSinceLastUpdate = 0L

                fos.use { out ->
                    while (din.read(buffer).also { read = it } != -1) {
                        out.write(buffer, 0, read)
                        totalRead += read
                        bytesSinceLastUpdate += read
                        
                        val now = System.currentTimeMillis()
                        if (now - lastUpdateTime > 500) { // Update UI every 500ms
                            val timeDiff = (now - lastUpdateTime) / 1000f
                            val speedMbps = if (timeDiff > 0) (bytesSinceLastUpdate / 1024f / 1024f) / timeDiff else 0f
                            val progress = if (fileSize > 0) (totalRead.toFloat() / fileSize) else 0f
                            
                            _transferInfo.update { 
                                it.copy(progress = progress, speedMbps = speedMbps) 
                            }
                            
                            lastUpdateTime = now
                            bytesSinceLastUpdate = 0
                        }
                    }
                }
                
                _transferInfo.update { it.copy(state = TransferState.COMPLETE, progress = 1f, speedMbps = 0f) }
            }
        } catch (e: Exception) {
            Log.e("TransferManager", "Receive error", e)
            _transferInfo.update { it.copy(state = TransferState.ERROR) }
        }
    }

    suspend fun sendFile(peer: PeerDevice, uri: Uri) {
        withContext(Dispatchers.IO) {
            _transferInfo.update { it.copy(state = TransferState.CONNECTING, operation = "Sending to ${peer.name}") }
            try {
                // Get File Metadata
                var fileName = "unknown_file"
                var fileSize = 0L
                context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                        if (nameIndex != -1) fileName = cursor.getString(nameIndex)
                        if (sizeIndex != -1) fileSize = cursor.getLong(sizeIndex)
                    }
                }

                // Make connection
                val socket = Socket(peer.host, peer.port)
                socket.use { s ->
                    val dout = DataOutputStream(s.getOutputStream())
                    
                    // Send metadata
                    dout.writeUTF(fileName)
                    dout.writeLong(fileSize)
                    
                    _transferInfo.update { it.copy(state = TransferState.TRANSFERRING) }

                    // Send data
                    context.contentResolver.openInputStream(uri)?.use { inputStream ->
                        val buffer = ByteArray(8192)
                        var totalWritten: Long = 0
                        var read: Int
                        
                        val startTime = System.currentTimeMillis()
                        var lastUpdateTime = startTime
                        var bytesSinceLastUpdate = 0L

                        while (inputStream.read(buffer).also { read = it } != -1) {
                            dout.write(buffer, 0, read)
                            totalWritten += read
                            bytesSinceLastUpdate += read

                            val now = System.currentTimeMillis()
                            if (now - lastUpdateTime > 500) { 
                                val timeDiff = (now - lastUpdateTime) / 1000f
                                val speedMbps = if (timeDiff > 0) (bytesSinceLastUpdate / 1024f / 1024f) / timeDiff else 0f
                                val progress = if (fileSize > 0) (totalWritten.toFloat() / fileSize) else 0f
                                
                                _transferInfo.update { 
                                    it.copy(progress = progress, speedMbps = speedMbps) 
                                }
                                
                                lastUpdateTime = now
                                bytesSinceLastUpdate = 0
                            }
                        }
                    }
                    dout.flush()
                }
                _transferInfo.update { it.copy(state = TransferState.COMPLETE, progress = 1f, speedMbps = 0f) }
            } catch (e: Exception) {
                Log.e("TransferManager", "Send error", e)
                _transferInfo.update { it.copy(state = TransferState.ERROR) }
            }
        }
    }
    
    fun resetState() {
        _transferInfo.update { TransferInfo() }
    }
}
