package com.omnitransfer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * OmniTransfer Android main activity.
 *
 * Extends Capacitor's BridgeActivity which handles the WebView setup,
 * plugin registration, and lifecycle management.
 * All OmniTransfer-specific logic lives in OmniTransferPlugin.java.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register OmniTransfer plugin before super.onCreate()
        registerPlugin(OmniTransferPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
