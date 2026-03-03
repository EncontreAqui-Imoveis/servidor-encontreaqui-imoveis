import { Request, Response } from 'express';
import AuthRequest from '../middlewares/auth';
import {
  getCurrentBrokerTerms,
  recordBrokerTermsAcceptance,
} from '../services/termsService';

class TermsController {
  async getCurrentTerms(req: Request, res: Response) {
    try {
      const terms = await getCurrentBrokerTerms();

      res.json(terms);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar termos.' });
    }
  }

  async acceptTerms(req: AuthRequest, res: Response) {
    const brokerId = req.userId;
    const { termsId } = req.body;

    if (!brokerId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      await recordBrokerTermsAcceptance(brokerId, termsId);

      res.json({ message: 'Termos aceitos com sucesso.' });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao registrar aceitação.' });
    }
  }
}

export const termsController = new TermsController();
