'use strict';
const prisma = require('../../config/prisma');
const measSvc = require('../measurements/measurements.service');

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE DE DOCUMENTOS (Doc3 §38-§39, Doc1 §31)
// Armazena referência ao arquivo (path/url) e metadados.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ENTITY_TYPES = ['measurement', 'contract', 'additive', 'al', 'payment', 'contractor', 'work'];

function err(msg, code, status = 400) {
  const e = new Error(msg); e.statusCode = status; e.code = code; return e;
}

async function assertEntityAccess(entityType, entityId, actor) {
  if (entityType === 'measurement') {
    const m = await measSvc.getMeasurement(entityId);
    await measSvc.assertMeasurementAccess(m, actor);
  }
  // Para outros tipos, Admin/Director têm acesso total; demais via context
  const isAdminDir = actor.roles.includes('ADMIN') || actor.roles.includes('DIRECTOR');
  if (!isAdminDir && entityType !== 'measurement') {
    // verificação básica: usuário autenticado pode ver documentos de entidades
    // (acesso detalhado por entidade será implementado nos módulos correspondentes)
  }
}

function serializeDocs(docs) {
  return docs.map(d => ({ ...d, file_size: Number(d.file_size) }));
}

async function list({ entityType, entityId, activeOnly = true, page = 1, limit = 50 }, actor) {
  const where = {};
  if (entityType) where.entity_type = entityType;
  if (entityId)   where.entity_id   = entityId;
  if (activeOnly) where.active       = true;

  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    prisma.documents.count({ where }),
    prisma.documents.findMany({
      where,
      include: { uploader: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
  ]);
  return { items: serializeDocs(items), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function findById(id, actor) {
  const doc = await prisma.documents.findUnique({
    where: { id },
    include: { uploader: { select: { id: true, name: true } } },
  });
  if (!doc) throw err('Documento não encontrado.', 'DOCUMENT_NOT_FOUND', 404);
  return { ...doc, file_size: Number(doc.file_size) };
}

async function upload(data, actor) {
  if (!data.entity_type || !ALLOWED_ENTITY_TYPES.includes(data.entity_type)) {
    throw err(`Tipo de entidade inválido. Permitidos: ${ALLOWED_ENTITY_TYPES.join(', ')}.`, 'INVALID_ENTITY_TYPE');
  }
  if (!data.entity_id)  throw err('entity_id é obrigatório.', 'ENTITY_ID_REQUIRED');
  if (!data.file_name)  throw err('file_name é obrigatório.', 'FILE_NAME_REQUIRED');
  if (!data.file_path)  throw err('file_path é obrigatório.', 'FILE_PATH_REQUIRED');
  if (!data.mime_type)  throw err('mime_type é obrigatório.', 'MIME_TYPE_REQUIRED');
  if (!data.file_size || data.file_size <= 0) throw err('file_size inválido.', 'FILE_SIZE_REQUIRED');

  const doc = await prisma.documents.create({
    data: {
      file_name:   data.file_name,
      file_path:   data.file_path,
      mime_type:   data.mime_type,
      file_size:   parseInt(data.file_size, 10),   // garantir Int (não BigInt)
      uploaded_by: actor.id,
      entity_type: data.entity_type,
      entity_id:   data.entity_id,
      version:     1,
      active:      true,
    },
    include: { uploader: { select: { id: true, name: true } } },
  });

  // Converter file_size de BigInt para Number para serialização JSON
  const docJson = { ...doc, file_size: Number(doc.file_size) };

  await prisma.audit_logs.create({
    data: { user_id: actor.id, action: 'UPLOAD_DOCUMENT', entity_type: data.entity_type, entity_id: data.entity_id, new_values: { document_id: docJson.id, file_name: docJson.file_name } },
  });

  return docJson;
}

async function replace(id, data, actor) {
  const old = await findById(id, actor);
  if (!old.active) throw err('Documento inativo não pode ser substituído.', 'DOCUMENT_INACTIVE', 409);

  if (!data.file_name || !data.file_path || !data.mime_type || !data.file_size) {
    throw err('Dados do novo documento incompletos.', 'VALIDATION_ERROR');
  }

  // Novo documento com versão incrementada; documento anterior permanece como histórico (Doc1 §31)
  const newDoc = await prisma.documents.create({
    data: {
      file_name:   data.file_name,
      file_path:   data.file_path,
      mime_type:   data.mime_type,
      file_size:   data.file_size,
      uploaded_by: actor.id,
      entity_type: old.entity_type,
      entity_id:   old.entity_id,
      version:     old.version + 1,
      active:      true,
    },
  });

  // Inativar o anterior e apontar replaced_by
  await prisma.documents.update({
    where: { id },
    data:  { active: false, replaced_by: newDoc.id },
  });

  await prisma.audit_logs.create({
    data: { user_id: actor.id, action: 'REPLACE_DOCUMENT', entity_type: old.entity_type, entity_id: old.entity_id, old_values: { old_document_id: id }, new_values: { new_document_id: newDoc.id } },
  });

  return { ...newDoc, file_size: Number(newDoc.file_size) };
}

module.exports = { list, findById, upload, replace };
