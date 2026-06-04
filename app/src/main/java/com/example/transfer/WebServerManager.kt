package com.example.transfer

import android.content.Context
import android.os.Environment
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.atomic.AtomicBoolean

class WebServerManager(private val context: Context) {
    private var serverSocket: ServerSocket? = null
    private val isRunning = AtomicBoolean(false)
    var port = 8080 

    fun start(): Int {
        if (serverSocket != null) return serverSocket!!.localPort
        try {
            serverSocket = ServerSocket(8080)
            port = serverSocket!!.localPort
            isRunning.set(true)
            Thread {
                while (isRunning.get()) {
                    try {
                        val client = serverSocket?.accept() ?: break
                        Thread { handleClient(client) }.start()
                    } catch (e: Exception) {
                        Log.e("WebServer", "Accept error", e)
                    }
                }
            }.start()
            return port
        } catch (e: Exception) {
            Log.e("WebServer", "Server error", e)
            return -1
        }
    }

    fun stop() {
        isRunning.set(false)
        try {
            serverSocket?.close()
        } catch(e: Exception) {}
        serverSocket = null
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        var c: Int
        while (true) {
            c = input.read()
            if (c == -1) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) break
            if (c != '\r'.code) {
                sb.append(c.toChar())
            }
        }
        return sb.toString()
    }

    private fun handleClient(socket: Socket) {
        socket.use { s ->
            try {
                val input = s.getInputStream()
                val output = s.getOutputStream()
                
                val requestLine = readLine(input) ?: return
                Log.d("WebServer", "Request: $requestLine")
                
                val parts = requestLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0]
                val path = parts[1]
                
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = readLine(input)
                    if (line.isNullOrEmpty()) break
                    val headerParts = line.split(": ", limit = 2)
                    if (headerParts.size == 2) {
                        headers[headerParts[0].lowercase()] = headerParts[1]
                    }
                }

                if (method == "GET" && path == "/") {
                    serveHtml(output)
                } else if (method == "GET" && path.startsWith("/download")) {
                    val uriParts = path.split("?")
                    var filename = ""
                    if (uriParts.size > 1) {
                        val query = uriParts[1].split("&")
                        for (q in query) {
                            val kv = q.split("=")
                            if (kv.size == 2 && kv[0] == "filename") {
                                filename = URLDecoder.decode(kv[1], "UTF-8")
                            }
                        }
                    }
                    serveFileDownload(filename, output)
                } else if (method == "POST" && path.startsWith("/upload")) {
                    val uriParts = path.split("?")
                    var filename = "uploaded_file"
                    if (uriParts.size > 1) {
                        val query = uriParts[1].split("&")
                        for (q in query) {
                            val kv = q.split("=")
                            if (kv.size == 2 && kv[0] == "filename") {
                                filename = URLDecoder.decode(kv[1], "UTF-8")
                            }
                        }
                    }
                    val length = headers["content-length"]?.toLongOrNull() ?: 0L
                    saveUploadedFile(input, length, filename, output)
                } else {
                    sendResponse(output, 404, "Not Found", "404 Not Found")
                }
            } catch (e: Exception) {
                Log.e("WebServer", "Client error", e)
            }
        }
    }

    private fun serveHtml(output: OutputStream) {
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val files = downloadsDir.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() }?.take(10) ?: emptyList()
        
        var fileListHtml = ""
        if (files.isEmpty()) {
            fileListHtml = "<p>No recent files available.</p>"
        } else {
            files.forEach { file ->
                val encodedName = java.net.URLEncoder.encode(file.name, "UTF-8")
                fileListHtml += "<div style='padding: 8px; border-bottom: 1px solid #1c2636;'>" +
                                "<a style='color: #00E5FF; text-decoration: none;' href='/download?filename=${encodedName}'>⬇ ${file.name}</a>" +
                                "</div>"
            }
        }

        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>OmniTransfer Local</title>
                <style>
                    body { font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0A0E17; color: white; }
                    .card { background: #131A26; padding: 20px; border-radius: 12px; margin-top: 20px; }
                    button { background: #00E5FF; color: black; border: none; padding: 12px 20px; border-radius: 8px; font-weight: bold; width: 100%; cursor: pointer;}
                    input[type=file] { margin-bottom: 20px; width: 100%; color: white;}
                    #status { margin-top: 10px; color: #00E5FF; font-weight: bold; }
                    .progress-bar { width: 100%; background: #1c2636; height: 10px; border-radius: 5px; margin-top: 10px; overflow: hidden; }
                    #progress-fill { width: 0%; background: #00E5FF; height: 100%; transition: width 0.2s; }
                </style>
            </head>
            <body>
                <h1>OmniTransfer</h1>
                <div class="card">
                    <h3>Send File to Device</h3>
                    <input type="file" id="fileInput">
                    <button onclick="upload()">Send to Phone</button>
                    <div id="status"></div>
                    <div class="progress-bar"><div id="progress-fill"></div></div>
                </div>
                
                <div class="card">
                    <h3>Receive Files from Device</h3>
                    <p style='color: #A0AAB2; font-size: 14px;'>Recent files in Downloads folder:</p>
                    $fileListHtml
                </div>
                <script>
                    function upload() {
                        const file = document.getElementById('fileInput').files[0];
                        if (!file) { alert('Select a file first'); return; }
                        const status = document.getElementById('status');
                        const progressFill = document.getElementById('progress-fill');
                        status.innerText = 'Uploading...';
                        
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', '/upload?filename=' + encodeURIComponent(file.name), true);
                        
                        xhr.upload.onprogress = function(e) {
                            if (e.lengthComputable) {
                                const percent = (e.loaded / e.total * 100).toFixed(1);
                                status.innerText = 'Uploading... ' + percent + '%';
                                progressFill.style.width = percent + '%';
                            }
                        };
                        
                        xhr.onload = function() {
                            if (xhr.status == 200) { 
                                status.innerText = 'Upload Complete! Reloading...'; 
                                progressFill.style.width = '100%';
                                setTimeout(() => window.location.reload(), 1000);
                            } else { 
                                status.innerText = 'Error: ' + xhr.responseText; 
                                progressFill.style.background = 'red';
                            }
                        };
                        
                        xhr.onerror = function() {
                            status.innerText = 'Network Error.';
                        };
                        
                        xhr.send(file);
                    }
                </script>
            </body>
            </html>
        """.trimIndent()
        
        sendResponse(output, 200, "OK", html, "text/html")
    }

    private fun serveFileDownload(filename: String, output: OutputStream) {
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            val file = File(downloadsDir, filename)
            if (!file.exists() || !file.isFile || filename.contains("..")) {
                sendResponse(output, 404, "Not Found", "File not found")
                return
            }
            
            val headers = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: application/octet-stream\r\n" +
                    "Content-Disposition: attachment; filename=\"$filename\"\r\n" +
                    "Content-Length: ${file.length()}\r\n" +
                    "Connection: close\r\n\r\n"
                    
            output.write(headers.toByteArray())
            
            val fis = java.io.FileInputStream(file)
            val buffer = ByteArray(8192)
            var read: Int
            while (fis.read(buffer).also { read = it } != -1) {
                output.write(buffer, 0, read)
            }
            fis.close()
            output.flush()
        } catch (e: Exception) {
            Log.e("WebServer", "Download error", e)
        }
    }

    private fun saveUploadedFile(input: InputStream, length: Long, filename: String, output: OutputStream) {
        try {
            val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!downloadsDir.exists()) downloadsDir.apply { mkdirs() }
            
            val outFile = File(downloadsDir, filename)
            val fos = FileOutputStream(outFile)
            
            val buffer = ByteArray(8192)
            var totalRead = 0L
            var read: Int
            
            while (totalRead < length) {
                val toRead = if (length - totalRead > buffer.size) buffer.size else (length - totalRead).toInt()
                read = input.read(buffer, 0, toRead)
                if (read == -1) break
                fos.write(buffer, 0, read)
                totalRead += read
            }
            fos.close()
            sendResponse(output, 200, "OK", "Saved $filename")
        } catch (e: Exception) {
            Log.e("WebServer", "Save error", e)
            sendResponse(output, 500, "Internal Server Error", e.message ?: "Unknown error")
        }
    }

    private fun sendResponse(output: OutputStream, code: Int, status: String, body: String, contentType: String = "text/plain") {
        val out = body.toByteArray()
        val headers = "HTTP/1.1 $code $status\r\n" +
                "Access-Control-Allow-Origin: *\r\n" + 
                "Content-Type: $contentType\r\n" +
                "Content-Length: ${out.size}\r\n" +
                "Connection: close\r\n\r\n"
        output.write(headers.toByteArray())
        output.write(out)
        output.flush()
    }
}
