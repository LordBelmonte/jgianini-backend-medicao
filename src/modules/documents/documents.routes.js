'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('./documents.controller');
const authenticate      = require('../../middlewares/authenticate');
const requirePermission = require('../../middlewares/requirePermission');

router.use(authenticate);
router.get ('/',         requirePermission('documents.view'),   ctrl.list);
router.get ('/:id',      requirePermission('documents.view'),   ctrl.findById);
router.post('/',         requirePermission('documents.upload'),  ctrl.upload);
router.post('/:id/replace', requirePermission('documents.upload'), ctrl.replace);

module.exports = router;
