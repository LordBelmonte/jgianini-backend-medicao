'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./notifications.controller');
const authenticate = require('../../middlewares/authenticate');

router.use(authenticate);
router.get ('/',          ctrl.list);
router.post('/read-all',  ctrl.markAllRead);
router.post('/:id/read',  ctrl.markRead);

module.exports = router;
