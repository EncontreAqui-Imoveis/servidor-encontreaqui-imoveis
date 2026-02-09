import { Request, Response } from 'express';
import { NegotiationService } from '../application/NegotiationService';

class NegotiationsController {
  private negotiationService: NegotiationService;

  constructor() {
    this.negotiationService = new NegotiationService();
  }

  async create(req: Request, res: Response) {
    try {
      const data = req.body;
      const userId = (req as any).user.id;

      // Ensure the creator is the one logged in? 
      // The DTO has created_by_user_id, but we should override/ensure it.
      data.created_by_user_id = userId;
      // Also if user is broker, set captador or seller based on context?
      // For now, let the service or client handle roles, but usually we enforce userId.

      const negotiation = await this.negotiationService.createDraft(data);
      return res.status(201).json(negotiation);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }

  async submitForActivation(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const negotiation = await this.negotiationService.submitForActivation(Number(id), userId);
      return res.json(negotiation);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  }

  async activateByAdmin(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }

  async reviewDocument(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }

  async publishContract(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }

  async validateSignature(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }

  async approveClose(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }

  async markNoCommission(req: Request, res: Response) {
    return res.status(501).json({ error: 'Not implemented yet' });
  }
}

export const negotiationsController = new NegotiationsController();
