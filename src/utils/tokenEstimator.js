/**
 * Token数量估算器
 * 用于在调用AI前估算提示词的token消耗
 * 采用简单的字符计数启发式方法（不依赖外部库）
 */

/**
 * 估算文本的token数量
 * 粗略规则：英文约4字符=1token，中文约1.5字符=1token
 * @param {string} text - 文本内容
 * @returns {number} 估算的token数量
 */
export function estimateTokens(text) {
  if (!text) return 0;

  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x4e00 && code < 0x9fff) {
      // CJK字符，约1.5字符=1token
      tokens += 0.67;
    } else if (code > 0x7f) {
      // 其他非ASCII字符
      tokens += 0.5;
    } else {
      // ASCII字符，约4字符=1token
      tokens += 0.25;
    }
  }

  return Math.ceil(tokens);
}

/**
 * 估算消息数组的总token数量
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  if (!messages || messages.length === 0) return 0;

  let total = 0;
  for (const msg of messages) {
    // 每条消息有固定开销（约4token用于role和格式）
    total += 4;
    total += estimateTokens(msg.content || '');
  }
  return total;
}
