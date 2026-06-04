package com.example

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.example.transfer.PeerDevice
import com.example.ui.screens.DiscoveryScreen
import com.example.ui.screens.TransferScreen
import com.example.ui.theme.OmniTransferTheme
import com.example.viewmodel.TransferViewModel

class MainActivity : ComponentActivity() {
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        // Handle Permission granted/rejected
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestPermissions()

        enableEdgeToEdge()
        setContent {
            OmniTransferTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    OmniTransferApp()
                }
            }
        }
    }

    private fun requestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE,
            Manifest.permission.ACCESS_WIFI_STATE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES)
            permissions.add(Manifest.permission.READ_MEDIA_VIDEO)
            permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            requestPermissionLauncher.launch(missing.toTypedArray())
        }
    }
}

@Composable
fun OmniTransferApp(viewModel: TransferViewModel = viewModel()) {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = "discovery") {
        composable("discovery") {
            DiscoveryScreen(
                viewModel = viewModel,
                onDeviceSelected = { deviceName ->
                    navController.navigate("transfer/$deviceName")
                },
                onReceiveRequested = {
                    navController.navigate("transfer/receiving")
                }
            )
        }
        composable(
            route = "transfer/{deviceName}",
            arguments = listOf(navArgument("deviceName") { type = NavType.StringType })
        ) { backStackEntry ->
            val deviceName = backStackEntry.arguments?.getString("deviceName") ?: "Unknown Device"
            TransferScreen(
                viewModel = viewModel,
                deviceName = deviceName,
                onComplete = { navController.popBackStack() }
            )
        }
    }
}
