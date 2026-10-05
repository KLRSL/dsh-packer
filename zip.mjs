// ============================================================================
// zip.mjs —— 纯 JS 读写 ZIP（零外部命令、零运行时依赖）
//
// 为什么自己写：此前归档走系统 tar —— Windows 是 bsdtar（能产真 zip），
// Linux 的 GNU tar 对 .zip 后缀实际产 tar 容器、且读不了真 zip，
// 于是**包不能跨操作系统互通**（CI 上暴露过一次）。
// 现在「创建 / 列成员 / 解包」全走这里：node:zlib 的 deflateRawSync / inflateRawSync。
//
// 边界（有意为之）：
//   - 整文件读入内存：打包对象是配置/技能/记忆镜像，量级在 MB 以内；
//   - 不支持 zip64：遇到就明确报错，绝不静默错读。
// ============================================================================
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import zlib from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const FLAG_UTF8 = 0x0800
const S_IFMT = 0xf000
const S_IFDIR = 0x4000
const S_IFLNK = 0xa000
const S_IFREG = 0x8000

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  return { time, date }
}

/** 把条目写成 zip 字节：{ name（用 '/' 分隔）, data(Buffer|string) }[] */
export function buildZip(entries, now = new Date()) {
  const { time, date } = dosDateTime(now)
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(String(e.name).replace(/\\/g, '/'), 'utf-8')
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '')
    // 压缩后没变小就原样存（stored），避免小文件白搭 deflate 头
    const comp = zlib.deflateRawSync(data, { level: 9 })
    const useDeflate = comp.length < data.length
    const body = useDeflate ? comp : data
    const method = useDeflate ? 8 : 0
    const crc = crc32(data)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(SIG_LOCAL, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(FLAG_UTF8, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt16LE(time, 10)
    lh.writeUInt16LE(date, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    localParts.push(lh, nameBuf, body)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(SIG_CENTRAL, 0)
    ch.writeUInt16LE(0x031e, 4) // 制作版本：Unix + zip 3.0
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(FLAG_UTF8, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt16LE(time, 12)
    ch.writeUInt16LE(date, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38) // 外部属性高 16 位 = Unix 权限（普通文件）；>>>0 避免 32 位符号溢出
    ch.writeUInt32LE(offset, 42)
    centralParts.push(ch, nameBuf)

    offset += lh.length + nameBuf.length + body.length
  }
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, central, eocd])
}

export async function writeZipFile(outPath, entries) {
  await fsp.writeFile(outPath, buildZip(entries))
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === SIG_EOCD) return i
  return -1
}

/** 解析中央目录：返回条目元数据（不解压数据） */
export function parseZip(buf) {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error('找不到 ZIP 结束记录（EOCD），不是有效的 zip')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw new Error('包含 zip64 扩展信息，当前版本不支持（请重新打包）')
  }
  if (cdOff + cdSize > buf.length) throw new Error('中央目录偏移越界（文件被截断或损坏）')
  const entries = []
  let p = cdOff
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('中央目录损坏（记录数与内容不一致）')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const external = buf.readUInt32LE(p + 38)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString((flags & FLAG_UTF8) ? 'utf-8' : 'latin1')
    entries.push({ name, method, flags, crc, compSize, size, externalAttrs: external, unixMode: (external >>> 16) & 0xffff, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function readZipFile(zipPath) {
  const buf = fs.readFileSync(zipPath)
  return { buf, entries: parseZip(buf) }
}

/** 条目类型：file / dir / symlink / special（类型取自中央目录里的 Unix mode） */
export function entryKind(e) {
  if (e.name.endsWith('/')) return 'dir'
  const m = e.unixMode & S_IFMT
  if (m === S_IFDIR) return 'dir'
  if (m === S_IFLNK) return 'symlink'
  if (m === 0 || m === S_IFREG) return 'file'
  return 'special'
}

/** 读取单个条目内容（并校验 CRC） */
export function readEntryData(buf, e) {
  const lo = e.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) throw new Error(`本地文件头异常: ${e.name}`)
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  if (start + e.compSize > buf.length) throw new Error(`成员数据越界: ${e.name}`)
  const raw = buf.subarray(start, start + e.compSize)
  let data
  if (e.method === 0) data = Buffer.from(raw)
  else if (e.method === 8) data = zlib.inflateRawSync(raw)
  else throw new Error(`不支持的压缩方法 ${e.method}: ${e.name}`)
  if (crc32(data) !== e.crc) throw new Error(`成员校验失败（CRC 不匹配）: ${e.name}`)
  return data
}
