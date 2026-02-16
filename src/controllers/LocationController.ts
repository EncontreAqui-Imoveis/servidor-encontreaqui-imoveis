import { Request, Response } from 'express';
import axios from 'axios';

const CEP_DIGITS_REGEX = /^\d{8}$/;

function sanitizeCep(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/\D/g, '');
}

class LocationController {
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
