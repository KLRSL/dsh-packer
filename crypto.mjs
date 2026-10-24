// ============================================================================
// crypto.mjs —— dsh-packer v0.4.0 加密包（PKENC1）
//
// 零原生依赖：只用 node:crypto 的 scrypt + aes-256-gcm。
// 二进制布局（契约 §8，不可改）：
//   magic "PKENC1\0" + salt[16] + iv[12] + tag[16] + ciphertext
// 算法：key = scrypt(password, salt, 32, {N:16384, r:8, p:1})；aes-256-gcm 加密 zip 明文。
//
// 设计取舍：
//   - 每次加密随机 salt/iv —— 同一密码两次打包密文不同（不可比对）；
//   - 密码错误 / 缺少密码一律抛 BadPasswordError（code='bad_password'），
//     HTTP 层据此回 400，绝不把解密异常漏成 500（GCM 鉴权失败也不泄露内部细节）；
//   - 只做「整包加密」，不做流式：打包对象是配置/技能/记忆镜像，量级 MB 以内。
// ============================================================================
import crypto from 'node:crypto'

/** 加密包后缀（不写 .zip） */
export const PKENC_EXT = '.pkenc'

/** 魔数：'PKENC1' + NUL，共 7 字节 */
export const ENC_MAGIC = Buffer.from('PKENC1\0', 'latin1')

/** 加密密码最小长度（契约 §3：encrypt===true 且 password 长度 < 8 → 400 weak_password） */
export const MIN_PASSWORD_LENGTH = 8

const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/** scrypt 参数（契约 §8 固定 N=16384, r=8, p=1）；maxmem 显式抬高，避免大 N 下的默认限制误判 */
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** 头部总长（不含密文） */
export const HEADER_BYTES = ENC_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES

/** 密码错误 / 缺少密码：HTTP 层映射为 400 bad_password */
export class BadPasswordError extends Error {
  constructor(message = '密码错误，无法解密该加密包') {
    super(message)
    this.name = 'BadPasswordError'
    this.code = 'bad_password'
  }
}

export function isBadPasswordError(err) {
  return err?.code === 'bad_password'
}

/** 嗅探魔数：命中即视为加密包（不解析内容，供 listPacks / 恢复入口前置判断） */
export function isEncryptedBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < ENC_MAGIC.length) return false
  return buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, KEY_BYTES, SCRYPT_OPTIONS, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

/**
 * 加密一段 zip 明文。
 * @param {Buffer} plain zip 字节
 * @param {string} password 明文密码（长度 >= MIN_PASSWORD_LENGTH，调用方已校验）
 * @returns {Promise<Buffer>} PKENC1 包字节
 */
export async function encryptZipBuffer(plain, password) {
  if (!Buffer.isBuffer(plain)) throw new TypeError('encryptZipBuffer 需要 Buffer 输入')
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new BadPasswordError(`加密密码至少 ${MIN_PASSWORD_LENGTH} 位`)
  }
  const salt = crypto.randomBytes(SALT_BYTES)
  const iv = crypto.randomBytes(IV_BYTES)
  const key = await deriveKey(password, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_BYTES) throw new Error(`GCM tag 长度异常：${tag.length}（期望 ${TAG_BYTES}）`)
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, ciphertext])
}

/**
 * 解密 PKENC1 包。
 * 密码错误（GCM 鉴权失败）→ BadPasswordError（code='bad_password'），绝不抛出未分类的 500。
 * @param {Buffer} packed PKENC1 包字节
 * @param {string} password 明文密码
 * @returns {Promise<Buffer>} zip 明文
 */
export async function decryptZipBuffer(packed, password) {
  if (!Buffer.isBuffer(packed) || !isEncryptedBuffer(packed)) {
    throw new Error('不是加密包（缺少 PKENC1 魔数）')
  }
  if (packed.length < HEADER_BYTES) throw new BadPasswordError('加密包头不完整，无法解密')
  if (typeof password !== 'string' || password.length === 0) {
    throw new BadPasswordError('该包已加密（PKENC1），需要提供密码')
  }
  const salt = packed.subarray(ENC_MAGIC.length, ENC_MAGIC.length + SALT_BYTES)
  const iv = packed.subarray(ENC_MAGIC.length + SALT_BYTES, ENC_MAGIC.length + SALT_BYTES + IV_BYTES)
  const tag = packed.subarray(ENC_MAGIC.length + SALT_BYTES + IV_BYTES, HEADER_BYTES)
  const ciphertext = packed.subarray(HEADER_BYTES)
  const key = await deriveKey(password, salt)
  let decipher
  try {
    decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    // GCM 鉴权失败 = 密码错误或密文被篡改；两者对调用方同一处置（400 bad_password），
    // 且不把底层错误细节回给浏览器
    throw new BadPasswordError('密码错误或包已损坏，无法解密该加密包')
  }
}
