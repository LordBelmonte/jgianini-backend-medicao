'use strict';
const svc = require('./notifications.service');

async function list(req, res, next) {
  try {
    const { page, limit, unread_only } = req.query;
    const result = await svc.list(req.user, { page: parseInt(page||1,10), limit: parseInt(limit||50,10), unreadOnly: unread_only === 'true' });
    res.status(200).json({ success: true, ...result });
  } catch (e) { next(e); }
}
async function markRead(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.markRead(req.params.id, req.user) }); }
  catch (e) { next(e); }
}
async function markAllRead(req, res, next) {
  try { res.status(200).json({ success: true, data: await svc.markAllRead(req.user) }); }
  catch (e) { next(e); }
}
module.exports = { list, markRead, markAllRead };
