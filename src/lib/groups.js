export const defaultGroups = { A: 'กลุ่มทั่วไป', B: 'กลุ่มประสบการณ์' };

export function groupLabels(settings = {}) {
  return { A: settings.groupNameA || defaultGroups.A, B: settings.groupNameB || defaultGroups.B };
}

export function queueGroup(queue) {
  if (queue.service_group === 'A' || queue.service_group === 'B') return queue.service_group;
  return /^(A|กลุ่มทั่วไป)\d{3,}$/.test(queue.queue_number || '') ? 'A'
    : /^(B|กลุ่มประสบการณ์)\d{3,}$/.test(queue.queue_number || '') ? 'B' : null;
}

export function namedQueue(queue, names = defaultGroups) {
  const group = queueGroup(queue);
  const canonical = queue.canonical_queue_number || queue.queue_number;
  const digits = canonical?.match(/\d{3,}$/)?.[0];
  return group && digits ? { ...queue, service_group: group, canonical_queue_number: canonical, queue_number: `${names[group]}${digits}` } : queue;
}

export function validGroupName(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(value);
}
