// Snapshots may interleave groups; order each group's waiting line independently.
export function groupQueues(queues, group) {
  const items = queues.filter(queue => queue.service_group === group);
  return {
    current: items.find(queue => queue.status === 'calling'),
    waiting: items.filter(queue => queue.status === 'waiting').sort((a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)),
  };
}
