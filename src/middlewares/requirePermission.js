'use strict';

/**
 * Middleware de autorização por permissão granular
 *
 * Referência: Documento 5 — seções 38-41, 49-50, 55
 *             Documento 2 — seção 11
 *
 * Hierarquia de verificação (Doc5 §41):
 *   1. Usuário autenticado?        → garantido pelo middleware authenticate antes deste
 *   2. Usuário ativo?              → garantido pelo middleware authenticate antes deste
 *   3. Possui a permissão?         → verificado aqui
 *   4. Possui vínculo com a obra?  → verificado nos Services quando aplicável
 *   5. Status do registro?         → verificado nos Services
 *   6. Regra de negócio?           → verificado nos Services
 *
 * Uso:
 *   router.get('/', authenticate, requirePermission('users.view'), controller.list)
 *   router.post('/', authenticate, requirePermission('users.create'), controller.create)
 *
 * Resposta sem permissão: 403 Forbidden (Doc4 §6, Doc5 §42)
 *
 * IMPORTANTE: "Não confiar somente no perfil" (Doc5 §40)
 * Verificar sempre a permissão granular, não apenas o nome do role.
 */

/**
 * @param {string} permissionCode - código da permissão (ex: 'users.view')
 * @returns {Function} middleware Express
 */
function requirePermission(permissionCode) {
  return function (req, res, next) {
    // req.user é injetado pelo middleware authenticate
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code:    'MISSING_TOKEN',
          message: 'Token de autenticação não fornecido.',
        },
      });
    }

    const hasPermission = req.user.permissions.includes(permissionCode);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: {
          code:    'FORBIDDEN',
          message: 'Você não possui permissão para executar esta ação.',
        },
      });
    }

    next();
  };
}

module.exports = requirePermission;
