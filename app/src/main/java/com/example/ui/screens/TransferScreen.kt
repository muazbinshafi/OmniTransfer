package com.example.ui.screens

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.transfer.TransferState
import com.example.viewmodel.TransferViewModel

@Composable
fun TransferScreen(viewModel: TransferViewModel, deviceName: String, onComplete: () -> Unit) {
    val transferInfo by viewModel.transferInfo.collectAsState()
    val speedHistory = remember { mutableStateListOf<Float>() }

    LaunchedEffect(transferInfo.speedMbps) {
        if (transferInfo.state == TransferState.TRANSFERRING) {
            speedHistory.add(transferInfo.speedMbps)
            if (speedHistory.size > 50) speedHistory.removeAt(0)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AnimatedContent(
                targetState = transferInfo.state,
                transitionSpec = {
                    (fadeIn(animationSpec = tween(300)) + slideInVertically { it / 2 }) togetherWith
                            (fadeOut(animationSpec = tween(300)) + slideOutVertically { -it / 2 })
                },
                label = "StatusText"
            ) { targetState ->
                val statusText = when (targetState) {
                    TransferState.IDLE -> "Waiting to transfer..."
                    TransferState.CONNECTING -> transferInfo.operation
                    TransferState.TRANSFERRING -> "Transferring\n$deviceName"
                    TransferState.ERROR -> "Transfer Failed"
                    TransferState.COMPLETE -> "Complete"
                }
                Text(
                    text = statusText,
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    fontWeight = FontWeight.Bold,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }

            Spacer(modifier = Modifier.height(48.dp))

            if (transferInfo.state == TransferState.TRANSFERRING) {
                Text(
                    text = "${String.format("%.1f", transferInfo.speedMbps)} MB/s",
                    style = MaterialTheme.typography.displayMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Black
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                SpeedGraph(
                    history = speedHistory,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp)
                )
                
                Spacer(modifier = Modifier.height(32.dp))
                
                LinearProgressIndicator(
                    progress = { transferInfo.progress },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp)),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surface
                )
                
                Spacer(modifier = Modifier.height(8.dp))
                
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("TCP Stream", color = MaterialTheme.colorScheme.tertiary, fontSize = 12.sp)
                    Text("${(transferInfo.progress * 100).toInt()}%", color = MaterialTheme.colorScheme.tertiary, fontSize = 12.sp)
                }
            } else if (transferInfo.state == TransferState.COMPLETE || transferInfo.state == TransferState.ERROR) {
                if (transferInfo.state == TransferState.COMPLETE) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = "Success",
                        tint = Color(0xFF00E676),
                        modifier = Modifier.size(100.dp)
                    )
                }
                Spacer(modifier = Modifier.height(48.dp))
                Button(
                    onClick = {
                        viewModel.resetTransferState()
                        onComplete()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(0.6f).height(56.dp)
                ) {
                    Text("Done", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                }
            } else {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
fun SpeedGraph(history: List<Float>, modifier: Modifier = Modifier) {
    val primaryColor = MaterialTheme.colorScheme.primary
    
    Canvas(modifier = modifier) {
        if (history.size < 2) return@Canvas
        
        val maxSpeed = (history.maxOrNull() ?: 10f).coerceAtLeast(10f)
        val width = size.width
        val height = size.height
        val pointSpacing = width / (50 - 1)
        
        val path = Path().apply {
            moveTo(0f, height - (history.first() / maxSpeed * height))
            history.forEachIndexed { index, speed ->
                val x = index * pointSpacing
                val y = height - (speed / maxSpeed * height)
                lineTo(x, y)
            }
        }
        
        drawPath(
            path = path,
            color = primaryColor,
            style = Stroke(width = 3.dp.toPx())
        )
    }
}
