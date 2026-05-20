/**
 * 唯一ID生成器
 */

let counter = 0;

/**
 * 生成带前缀的唯一ID
 * @param {string} prefix - ID前缀（如 'char', 'enemy', 'event', 'item'）
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  counter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${prefix}_${timestamp}${random}${counter}`;
}

/**
 * 重置计数器（仅用于测试）
 */
export function resetCounter() {
  counter = 0;
}
