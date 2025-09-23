import { Request, Response } from 'express';
import connection from '../database/connection';

class DashboardController {
  async getStats(req: Request, res: Response) {
    try {
      const [propertiesResult] = await connection.query('SELECT COUNT(*) as total FROM properties');
      const [brokersResult] = await connection.query('SELECT COUNT(*) as total FROM brokers');
      const [usersResult] = await connection.query('SELECT COUNT(*) as total FROM users');

      const stats = {
        totalProperties: (propertiesResult as any[])[0].total,
        totalBrokers: (brokersResult as any[])[0].total,
        totalUsers: (usersResult as any[])[0].total,
      };

      return res.json(stats);
    } catch (error) {
      console.error('Erro ao buscar estatísticas do dashboard:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
}

export const dashboardController = new DashboardController();