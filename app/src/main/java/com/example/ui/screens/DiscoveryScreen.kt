package com.example.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.transfer.PeerDevice
import com.example.transfer.TransferState
import com.example.viewmodel.TransferViewModel
import kotlinx.coroutines.delay

@Composable
fun DiscoveryScreen(
    viewModel: TransferViewModel,
    onDeviceSelected: (String) -> Unit,
    onReceiveRequested: () -> Unit
) {
    val devices by viewModel.peers.collectAsState()
    val transferInfo by viewModel.transferInfo.collectAsState()
    val networkInfo by viewModel.networkInfo.collectAsState()
    
    var selectedDevice by remember { mutableStateOf<PeerDevice?>(null) }
    
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null && selectedDevice != null) {
            viewModel.sendFile(selectedDevice!!, uri)
            onDeviceSelected(selectedDevice!!.name)
        }
    }

    LaunchedEffect(transferInfo.state) {
        if (transferInfo.state == TransferState.CONNECTING && transferInfo.operation == "Receiving") {
            onReceiveRequested()
        }
    }
    
    LaunchedEffect(Unit) {
        viewModel.networkHelper.updateLocalIp()
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column(modifier = Modifier.padding(top = 48.dp, start = 24.dp, end = 24.dp, bottom = 16.dp)) {
                Text(
                    text = "OmniTransfer",
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                )
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Web Server & Hotspot Info Card
            WebInterfaceCard(
                ipAddress = networkInfo.ipAddress,
                port = viewModel.webServerPort,
                isHotspot = networkInfo.isHotspot,
                ssid = networkInfo.ssid,
                password = networkInfo.password,
                onStartHotspot = { 
                    viewModel.networkHelper.startHotspot(
                        onSuccess = {}, 
                        onFailure = {} 
                    )
                },
                onStopHotspot = { viewModel.networkHelper.stopHotspot() }
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Nearby Devices (OmniTransfer App)",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
            )

            Box(
                modifier = Modifier
                    .fillMaxSize()
            ) {
                if (devices.isEmpty()) {
                    RadarAnimation(modifier = Modifier.align(Alignment.Center))
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        items(devices) { device ->
                            DeviceCard(device = device, onClick = { 
                                selectedDevice = device
                                filePicker.launch("*/*")
                            })
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun WebInterfaceCard(
    ipAddress: String, 
    port: Int, 
    isHotspot: Boolean,
    ssid: String,
    password: String?,
    onStartHotspot: () -> Unit,
    onStopHotspot: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Wifi,
                    contentDescription = "Web Access",
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = "Any Device Web Access",
                    color = MaterialTheme.colorScheme.onSurface,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Open this URL in any browser (Phone/PC) on the same Wi-Fi:",
                color = MaterialTheme.colorScheme.tertiary,
                fontSize = 14.sp
            )
            Spacer(modifier = Modifier.height(8.dp))
            if (ipAddress.isNotEmpty()) {
                Text(
                    text = "http://$ipAddress:$port",
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Black,
                    fontSize = 20.sp
                )
            } else {
                Text(
                    text = "Connect to Wi-Fi to share",
                    color = MaterialTheme.colorScheme.error,
                    fontStyle = androidx.compose.ui.text.font.FontStyle.Italic
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
            Divider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.1f))
            Spacer(modifier = Modifier.height(16.dp))

            if (!isHotspot) {
                Button(
                    onClick = onStartHotspot,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Icon(Icons.Default.WifiTethering, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Start Local Hotspot")
                }
            } else {
                Text("Hotspot: $ssid", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                if (password != null) {
                    Text("Password: $password", color = MaterialTheme.colorScheme.tertiary)
                }
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = onStopHotspot,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text("Stop Hotspot")
                }
            }
        }
    }
}

@Composable
fun DeviceCard(device: PeerDevice, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable { onClick() }
            .padding(20.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.PhoneAndroid,
                contentDescription = "Device Type",
                tint = MaterialTheme.colorScheme.primary
            )
        }
        
        Spacer(modifier = Modifier.width(16.dp))
        
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = device.name,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
                fontSize = 18.sp
            )
            Text(
                text = device.host.hostAddress ?: "Unknown IP",
                color = MaterialTheme.colorScheme.tertiary,
                fontSize = 14.sp
            )
        }
    }
}

@Composable
fun RadarAnimation(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "radar")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "radarAlpha"
    )
    val scale by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "radarScale"
    )

    val primaryColor = MaterialTheme.colorScheme.primary
    
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(200.dp)) {
            drawCircle(
                color = primaryColor.copy(alpha = alpha),
                radius = (size.width / 2) * scale,
            )
            drawCircle(
                color = primaryColor.copy(alpha = 0.2f),
                radius = size.width / 4,
                style = Stroke(width = 2.dp.toPx())
            )
            drawCircle(
                color = primaryColor.copy(alpha = 0.1f),
                radius = size.width / 2,
                style = Stroke(width = 2.dp.toPx())
            )
        }
    }
}
