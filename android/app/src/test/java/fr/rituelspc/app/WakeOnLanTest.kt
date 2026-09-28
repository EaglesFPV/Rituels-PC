package fr.rituelspc.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeOnLanTest {
    @Test
    fun parseMacAcceptsCommonFormats() {
        val expected = byteArrayOf(0x04, 0x42, 0x1A, 0x11, 0x22, 0x33)
        assertArrayEquals(expected, WakeOnLan.parseMac("04:42:1A:11:22:33"))
        assertArrayEquals(expected, WakeOnLan.parseMac("04-42-1a-11-22-33"))
        assertArrayEquals(expected, WakeOnLan.parseMac("04421A112233"))
    }

    @Test
    fun parseMacRejectsInvalidValues() {
        assertNull(WakeOnLan.parseMac(""))
        assertNull(WakeOnLan.parseMac("04:42:1A:11:22"))
        assertNull(WakeOnLan.parseMac("ZZ:42:1A:11:22:33"))
        assertNull(WakeOnLan.parseMac("04:42:1A:11:22:33:44"))
    }

    @Test
    fun magicPacketHasSixFFThenSixteenMacs() {
        val mac = WakeOnLan.parseMac("04:42:1A:11:22:33")
        assertNotNull(mac)
        val packet = WakeOnLan.packet(mac!!)
        assertEquals(102, packet.size)
        for (i in 0 until 6) assertEquals(0xFF.toByte(), packet[i])
        for (copy in 0 until 16) {
            assertArrayEquals(mac, packet.copyOfRange(6 + copy * 6, 12 + copy * 6))
        }
    }

    @Test
    fun onlyLocalNetworkAddressesAreAccepted() {
        assertTrue(isPrivateIPv4("192.168.1.20"))
        assertTrue(isPrivateIPv4("10.0.2.2"))
        assertTrue(isPrivateIPv4("172.16.5.4"))
        assertTrue(isPrivateIPv4("172.31.255.1"))
        assertFalse(isPrivateIPv4("172.32.0.1"))
        assertFalse(isPrivateIPv4("8.8.8.8"))
        assertFalse(isPrivateIPv4("192.168.1.20.evil.com"))
        assertFalse(isPrivateIPv4("evil.com"))
    }
}
