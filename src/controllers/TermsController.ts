import { Request, Response } from 'express';
import connection from '../database/connection';
import AuthRequest from '../middlewares/auth';

class TermsController {
  async getCurrentTerms(req: Request, res: Response) {
    try {
      const [terms] = await connection.query(
        'SELECT * FROM broker_terms WHERE active = TRUE ORDER BY created_at DESC LIMIT 1'
      ) as any[];
      
      res.json(terms);
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar termos.' });
    }
  }

  async acceptTerms(req: AuthRequest, res: Response) {
    const brokerId = req.userId;
    const { termsId } = req.body;

    try {
      await connection.query(
        'INSERT INTO broker_acceptances (broker_id, terms_id) VALUES (?, ?)',
        [brokerId, termsId]
      );
      
      res.json({ message: 'Termos aceitos com sucesso.' });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao registrar aceitação.' });
    }
  }
}

export const termsController = new TermsController();