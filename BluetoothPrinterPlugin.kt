// android/app/src/main/java/com/mwpos/app/BluetoothPrinterPlugin.kt
//
// Capacitor native plugin that exposes Bluetooth Classic (SPP) printing
// to the web layer.  Register this in MainActivity.kt.
//
// Permissions required in AndroidManifest.xml (already listed in that file).

package com.mwpos.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH],            alias = "bluetooth"),
        Permission(strings = [Manifest.permission.BLUETOOTH_ADMIN],      alias = "bluetoothAdmin"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT],    alias = "bluetoothConnect"),
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN],       alias = "bluetoothScan"),
    ]
)
class BluetoothPrinterPlugin : Plugin() {

    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    private var connectedAddress: String? = null

    // ── Helper: get BluetoothAdapter safely ─────────────────────────────────
    private fun getAdapter(): BluetoothAdapter? {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter
    }

    // ── listPaired ───────────────────────────────────────────────────────────
    @PluginMethod
    fun listPaired(call: PluginCall) {
        if (!hasBluetoothPermission()) {
            requestBluetoothPermissionsForCall(call, "listPairedCallback")
            return
        }
        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth not enabled")
            return
        }

        val arr = JSArray()
        try {
            val bonded = adapter.bondedDevices ?: emptySet()
            for (dev in bonded) {
                val obj = JSObject()
                obj.put("name",    dev.name    ?: "Unknown")
                obj.put("address", dev.address ?: "")
                arr.put(obj)
            }
        } catch (e: SecurityException) {
            call.reject("Permission denied: ${e.message}")
            return
        }

        val result = JSObject()
        result.put("devices", arr)
        call.resolve(result)
    }

    // ── connect ──────────────────────────────────────────────────────────────
    @PluginMethod
    fun connect(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.reject("address is required")
            return
        }
        if (!hasBluetoothPermission()) {
            requestBluetoothPermissionsForCall(call, "connectCallback")
            return
        }

        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth not enabled")
            return
        }

        // Disconnect existing socket if any
        closeSocket()

        Thread {
            try {
                val device: BluetoothDevice = adapter.getRemoteDevice(address)
                adapter.cancelDiscovery()
                val s = device.createRfcommSocketToServiceRecord(SPP_UUID)
                s.connect()
                socket = s
                outputStream = s.outputStream
                connectedAddress = address

                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } catch (e: Exception) {
                closeSocket()
                val result = JSObject()
                result.put("success", false)
                result.put("error", e.message ?: "Connection failed")
                call.resolve(result)
            }
        }.start()
    }

    // ── disconnect ───────────────────────────────────────────────────────────
    @PluginMethod
    fun disconnect(call: PluginCall) {
        closeSocket()
        call.resolve()
    }

    // ── isConnected ──────────────────────────────────────────────────────────
    @PluginMethod
    fun isConnected(call: PluginCall) {
        val connected = socket?.isConnected == true
        val result = JSObject()
        result.put("connected", connected)
        call.resolve(result)
    }

    // ── print ────────────────────────────────────────────────────────────────
    @PluginMethod
    fun print(call: PluginCall) {
        val dataArray = call.getArray("data")
        if (dataArray == null) {
            call.reject("data is required")
            return
        }

        val stream = outputStream
        if (stream == null || socket?.isConnected != true) {
            // Try to auto-reconnect if we have a saved address
            val addr = connectedAddress
            if (addr != null) {
                // Attempt reconnect synchronously in background
                call.reject("Not connected. Please reconnect the printer.")
            } else {
                call.reject("Not connected to any printer")
            }
            return
        }

        Thread {
            try {
                val bytes = ByteArray(dataArray.length()) { i ->
                    dataArray.getInt(i).toByte()
                }
                stream.write(bytes)
                stream.flush()

                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } catch (e: IOException) {
                closeSocket()
                val result = JSObject()
                result.put("success", false)
                result.put("error", e.message ?: "Print failed")
                call.resolve(result)
            }
        }.start()
    }

    // ── Internal helpers ─────────────────────────────────────────────────────
    private fun closeSocket() {
        try { outputStream?.close() } catch (_: Exception) {}
        try { socket?.close()       } catch (_: Exception) {}
        socket       = null
        outputStream = null
    }

    private fun hasBluetoothPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH) ==
                PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestBluetoothPermissionsForCall(call: PluginCall, callbackName: String) {
        saveCall(call)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(arrayOf("bluetoothConnect", "bluetoothScan"), call, callbackName)
        } else {
            requestPermissionForAliases(arrayOf("bluetooth", "bluetoothAdmin"), call, callbackName)
        }
    }

    @PermissionCallback
    private fun listPairedCallback(call: PluginCall) {
        if (hasBluetoothPermission()) listPaired(call)
        else call.reject("Bluetooth permission denied")
    }

    @PermissionCallback
    private fun connectCallback(call: PluginCall) {
        if (hasBluetoothPermission()) connect(call)
        else call.reject("Bluetooth permission denied")
    }
}