import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../middleware/auth.js'
import * as trailModel from '../models/trails.js'

export async function trailRoutes(app: FastifyInstance) {
  // GET /v1/trails - list trail summaries for the authenticated org
  app.get('/v1/trails', { preHandler: [requireAuth] }, async (request, reply) => {
    const { sensitivity } = request.query as { sensitivity?: string }
    const trails = await trailModel.listTrails(request.auth.org_id, sensitivity)
    return trails
  })

  // GET /v1/trails/:id - full trail with nodes and edges
  app.get('/v1/trails/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const trail = await trailModel.getTrail(request.auth.org_id, id)
    if (!trail) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Trail not found',
      })
    }
    return trail
  })
}
