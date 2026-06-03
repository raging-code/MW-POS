// android/app/src/main/java/com/mwpos/app/BluetoothPrinterPlugin.kt  — FIXED
//
// Fixes applied:
//
//  FIX A — closeSocket() no longer clears connectedAddress.
//    The old code set connectedAddress = null in closeSocket(), which meant the
//    TS side could not pass the correct address on reconnect after a drop.
//    connectedAddress is now only cleared in disconnect() (explicit user action).
//
//  FIX B — print() auto-reconnects instead of rejecting.
//    Old code called call.reject("Not connected") when the socket was gone.
//    Now it attempts to reconnect once using connectedAddress, then prints.
//    This handles the common case where BT drops between orders.
//
//  FIX C — createInsecureRfcommSocketToServiceRecord fallback.
//    Some cheap 57mm printers (like the orange/blue 1500mAh model) refuse
//    createRfcommSocketToServiceRecord on Android 10+. Added a fallback to
//    createInsecureRfcommSocketToServiceRecord via reflection.
//
//  FIX D — cancelDiscovery guarded by permission check.
//    On Android 12+, calling cancelDiscovery without BLUETOOTH_SCAN throws a
//    SecurityException which crashed the connect flow silently.
//
// Capacitor plugin contract:
//   listPaired()          → { devices: [{ name, address }] }
//   connect(address)      → { success: boolean, error?: string }
//   disconnect()          → void
//   print(data: number[]) → { success: boolean, error?: string }
//   isConnected()         → { connected: boolean }

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
    // FIX A: connectedAddress is preserved across socket close so reconnect works
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

        // Close any old socket (but keep connectedAddress — see FIX A)
        closeSocket()

        Thread {
            try {
                val device: BluetoothDevice = adapter.getRemoteDevice(address)

                // FIX D: guard cancelDiscovery with permission check on Android 12+
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
                            == PackageManager.PERMISSION_GRANTED) {
                            adapter.cancelDiscovery()
                        }
                    } else {
                        adapter.cancelDiscovery()
                    }
                } catch (_: Exception) { /* ignore */ }

                // FIX C: Try secure socket first; fall back to insecure for cheap printers
                val s: BluetoothSocket = try {
                    device.createRfcommSocketToServiceRecord(SPP_UUID)
                } catch (_: Exception) {
                    // Reflection-based insecure fallback (works on most BT 4.0 portables)
                    val m = device.javaClass.getMethod(
                        "createInsecureRfcommSocketToServiceRecord", UUID::class.java
                    )
                    m.invoke(device, SPP_UUID) as BluetoothSocket
                }

                s.connect()
                socket = s
                outputStream = s.outputStream
                connectedAddress = address   // FIX A: set here after success

                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } catch (e: Exception) {
                closeSocket()
                // FIX A: restore address so retry is possible
                connectedAddress = address
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
        connectedAddress = null   // FIX A: only clear address on explicit disconnect
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

        // FIX B: auto-reconnect if socket is gone but we know the address
        if (socket?.isConnected != true) {
            val addr = connectedAddress
            if (addr == null) {
                call.reject("Not connected to any printer")
                return
            }
            // Attempt a synchronous reconnect on this background-callable path.
            // The TS layer (nativePrint) already does an async reconnect before
            // calling print(), so this is a last-resort safety net.
            val adapter = getAdapter()
            if (adapter == null || !adapter.isEnabled) {
                call.reject("Bluetooth not enabled")
                return
            }
            try {
                closeSocket()
                val device: BluetoothDevice = adapter.getRemoteDevice(addr)
                val s: BluetoothSocket = try {
                    device.createRfcommSocketToServiceRecord(SPP_UUID)
                } catch (_: Exception) {
                    val m = device.javaClass.getMethod(
                        "createInsecureRfcommSocketToServiceRecord", UUID::class.java
                    )
                    m.invoke(device, SPP_UUID) as BluetoothSocket
                }
                s.connect()
                socket = s
                outputStream = s.outputStream
                connectedAddress = addr
            } catch (e: Exception) {
                connectedAddress = addr  // keep for next attempt
                val result = JSObject()
                result.put("success", false)
                result.put("error", "Reconnect failed: ${e.message}")
                call.resolve(result)
                return
            }
        }

        val stream = outputStream
        if (stream == null) {
            call.reject("Output stream unavailable")
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
                // FIX A: keep connectedAddress for reconnect on next print
                val result = JSObject()
                result.put("success", false)
                result.put("error", e.message ?: "Print failed")
                call.resolve(result)
            }
        }.start()
    }

    // ── Internal helpers ─────────────────────────────────────────────────────
    // FIX A: closeSocket does NOT touch connectedAddress
    private fun closeSocket() {
        try { outputStream?.close() } catch (_: Exception) {}
        try { socket?.close()       } catch (_: Exception) {}
        socket       = null
        outputStream = null
        // connectedAddress intentionally NOT cleared here (FIX A)
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