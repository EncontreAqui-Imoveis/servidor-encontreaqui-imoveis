import { Request, Response } from 'express';
import { loadDashboardStats } from '../services/dashboardStatsService';

class DashboardController {
  async getStats(req: Request, res: Response) {
    try {
      const stats = await loadDashboardStats();

      return res.json(stats);
    } catch (error) {
      console.error('Erro ao buscar estatísticas do dashboard:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
}

export const dashboardController = new DashboardController();
