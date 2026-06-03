// android/app/src/main/java/com/mwpos/app/MainActivity.kt
//
// This is the standard Capacitor MainActivity.
// The only change vs the default is registering BluetoothPrinterPlugin.

package com.mwpos.app

import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        // Register our custom plugin BEFORE super.onCreate
        registerPlugin(BluetoothPrinterPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}