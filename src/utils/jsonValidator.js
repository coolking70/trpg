/**
 * JSON Schema简易校验器
 * 不依赖外部库，提供基本的数据结构校验
 */

/**
 * 校验数据是否符合预期结构
 * @param {object} data - 要校验的数据
 * @param {object} schema - Schema定义
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(data, schema) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['数据必须是对象类型'] };
  }

  // 检查必填字段
  if (schema.required) {
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push(`缺少必填字段: ${field}`);
      }
    }
  }

  // 检查字段类型
  if (schema.fields) {
    for (const [field, rule] of Object.entries(schema.fields)) {
      const value = data[field];
      if (value === undefined || value === null) continue;

      if (rule.type && typeof value !== rule.type && rule.type !== 'array') {
        errors.push(`字段 ${field} 应为 ${rule.type} 类型，实际为 ${typeof value}`);
      }

      if (rule.type === 'array' && !Array.isArray(value)) {
        errors.push(`字段 ${field} 应为数组类型`);
      }

      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push(`字段 ${field} 的值不能小于 ${rule.min}`);
      }

      if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
        errors.push(`字段 ${field} 的值不能大于 ${rule.max}`);
      }

      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`字段 ${field} 的值必须是 [${rule.enum.join(', ')}] 之一`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验卡牌基础字段
 * @param {object} card - 卡牌数据
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCard(card) {
  return validate(card, {
    required: ['id', 'type', 'name'],
    fields: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['character', 'enemy', 'event', 'item'] },
      name: { type: 'string' },
    },
  });
}
