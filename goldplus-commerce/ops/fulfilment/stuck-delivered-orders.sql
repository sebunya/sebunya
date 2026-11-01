-- Orders the rider delivered (task Delivered, a delivered attempt on record) whose ORDER never said delivered.
-- Read-only. Each one is fixed on its order page: "Mark the order delivered" (2026-10-22).
select o.order_number, o.status as order_status, o.payment_status, o.payment_method,
       t.status as task_status, max(d.delivered_at) as delivered_at
  from fulfilment_tasks t
  join orders o on o.id = t.order_id
  join fulfilment_deliveries d on d.fulfilment_task_id = t.id and d.delivered_at is not null
 where t.status = 'DELIVERED' and o.status not in ('delivered', 'completed', 'cancelled', 'failed')
 group by o.order_number, o.status, o.payment_status, o.payment_method, t.status
 order by delivered_at desc;
