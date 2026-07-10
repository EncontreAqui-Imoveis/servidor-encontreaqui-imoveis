import { Request, Response } from 'express';
import axios from 'axios';

import {
  listLocationCities,
  listLocationNeighborhoods,
} from '../services/locationCatalogService';

const CEP_DIGITS_REGEX = /^\d{8}$/;

function sanitizeCep(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/\D/g, '');
}

class LocationController {
  async listCities(req: Request, res: Response) {
    try {
      return res.status(200).json(
        await listLocationCities(req.query as Record<string, unknown>)
      );
    } catch (error) {
      console.error('Erro ao listar cidades para autocomplete:', error);
      return res.status(500).json({ error: 'Não foi possível listar cidades.' });
    }
  }

  async listNeighborhoods(req: Request, res: Response) {
    const cityId = Number(req.query.cityId);
    if (!Number.isInteger(cityId) || cityId <= 0) {
      return res.status(400).json({ error: 'cityId deve ser um inteiro positivo.' });
    }

    try {
      return res.status(200).json(
        await listLocationNeighborhoods(cityId, req.query as Record<string, unknown>)
      );
    } catch (error) {
      console.error('Erro ao listar bairros para autocomplete:', error);
      return res.status(500).json({ error: 'Não foi possível listar bairros.' });
    }
  }

  async getByCep(req: Request, res: Response) {
    const cep = sanitizeCep(req.params.cep);

    if (!CEP_DIGITS_REGEX.test(cep)) {
      return res.status(400).json({
        error: 'CEP invalido. Informe 8 digitos.',
      });
    }

    try {
      const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, {
        timeout: 5000,
      });

      if (!data || data.erro === true) {
        return res.status(404).json({
          error: 'CEP nao encontrado.',
        });
      }

      return res.json({
        logradouro: data.logradouro ?? '',
        bairro: data.bairro ?? '',
        localidade: data.localidade ?? '',
        uf: data.uf ?? '',
      });
    } catch (error) {
      return res.status(404).json({
        error: 'Nao foi possivel consultar o CEP no momento.',
      });
    }
  }
}

export const locationController = new LocationController();
