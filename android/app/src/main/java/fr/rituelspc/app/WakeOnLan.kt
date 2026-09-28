package fr.rituelspc.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.nio.ByteBuffer

/** Envoi du « paquet magique » Wake-on-LAN : 6 octets 0xFF puis 16 fois l'adresse MAC, en diffusion UDP. */
object WakeOnLan {
    fun parseMac(mac: String): ByteArray? {
        val hex = mac.filter { it.isLetterOrDigit() }
        if (hex.length != 12 || !hex.all { it in "0123456789abcdefABCDEF" }) return null
        return ByteArray(6) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    fun packet(mac: ByteArray): ByteArray = ByteArray(6) { 0xFF.toByte() } + ByteArray(96) { mac[it % 6] }

    /** Renvoie true si au moins un paquet est parti. À appeler hors du thread principal. */
    fun send(context: Context, mac: String): Boolean {
        val bytes = parseMac(mac) ?: return false
        val payload = packet(bytes)
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = lanNetwork(manager)
        val targets = linkedSetOf("255.255.255.255")
        network?.let { directedBroadcast(manager, it) }?.let { targets += it }

        var sent = false
        DatagramSocket().use { socket ->
            socket.broadcast = true
            network?.bindSocket(socket) // impose le Wi-Fi même si les données mobiles sont actives
            for (target in targets) {
                for (port in intArrayOf(9, 7)) {
                    runCatching {
                        socket.send(DatagramPacket(payload, payload.size, InetAddress.getByName(target), port))
                        sent = true
                    }
                }
            }
        }
        return sent
    }

    @Suppress("DEPRECATION")
    private fun lanNetwork(manager: ConnectivityManager): Network? = manager.allNetworks.firstOrNull { network ->
        manager.getNetworkCapabilities(network)?.let {
            it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || it.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
        } == true
    }

    /** Adresse de diffusion du sous-réseau (ex. 192.168.1.255), plus fiable que la diffusion générale sur certains routeurs. */
    private fun directedBroadcast(manager: ConnectivityManager, network: Network): String? {
        val link = manager.getLinkProperties(network)?.linkAddresses?.firstOrNull { it.address is Inet4Address } ?: return null
        val address = ByteBuffer.wrap(link.address.address).int
        val prefix = link.prefixLength
        val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
        val broadcast = address or mask.inv()
        return InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(broadcast).array()).hostAddress
    }
}
