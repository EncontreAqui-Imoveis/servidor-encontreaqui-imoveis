import 'dotenv/config';
import express from 'express';
import cors from 'cors'; 
import mainRoutes from './routes';
import publicRoutes from './routes/public.routes';  

const app = express();
const PORT = process.env.API_PORT || 3333;

app.use(cors());
app.use(express.json());
app.use(mainRoutes);
app.use(publicRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});