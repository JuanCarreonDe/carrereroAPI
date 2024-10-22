// Importar dependencias y configuración
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

// Cargar variables de entorno
dotenv.config();

// Inicializa Express y Supabase
const app = express();
const port = process.env.PORT || 3000;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Permitir peticiones desde cualquier origen (puedes restringirlo a tu dominio en producción)
app.use(cors());

// Middleware para parsear JSON
app.use(express.json());

// Ruta para recibir los pagos de PayPal (webhook)
app.post("/webhook/paypal", async (req, res) => {
  const { orderID, transactionData } = req.body; // Asegúrate de desestructurar correctamente

  if (!orderID) {
    return res.status(400).json({ error: "Falta orderID" });
  }

  try {
    // Valida el pago en PayPal
    const accessToken = await getPayPalAccessToken();
    const paymentData = await validatePayPalPayment(orderID, accessToken);

    if (paymentData.status === "COMPLETED") {
      // Usa transactionData para insertar en la base de datos
      const {
        transaction_id,
        status,
        amount,
        currency,
        payer_name,
        payer_email,
        create_time,
        // order_id,
        user_id,
      } = transactionData;

      // Inserta la transacción en Supabase
      const { data, error } = await supabase.from("transactions").insert([
        {
          user_id: user_id, // Asegúrate de tener el ID del usuario
          order_id: orderID, // Usa el orderID recibido
          transaction_id: transaction_id,
          payer_email: payer_email,
          payer_name: payer_name,
          amount: amount,
          currency: currency,
          create_time: create_time,
          status: status,
        },
      ]);

      console.log("log antes de insert", transactionData);

      if (error) {
        console.error("Error insertando en Supabase:", error);
        return res
          .status(500)
          .json({ error: "Error insertando en la base de datos" });
      } else {
        console.log("upsert supabase");

        const { data, error } = await supabase.from("subscriptions").upsert([
          {
            user_id: user_id, // ID del usuario
            end_date: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000), // 1 mes a partir de ahora
            transaction_id: transaction_id, // ID de la transacción
          },
        ]);
        if (error) return res.status(400).json({ error: error.message });
        return res.status(200).json({ message: "Subscripcion actualizada" });
      }
    } else {
      return res.status(400).json({ error: "Pago no completado" });
    }
  } catch (err) {
    console.error("Error validando el pago:", err);
    return res.status(500).json({ error: "Error al validar el pago" });
  }
});

// Inicializar servidor en el puerto 3000
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});

// Funciones auxiliares para PayPal
async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const response = await fetch(
    "https://api.sandbox.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );
  const data = await response.json();
  return data.access_token;
}

async function validatePayPalPayment(orderID, accessToken) {
  const response = await fetch(
    `https://api.sandbox.paypal.com/v2/checkout/orders/${orderID}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  return await response.json();
}
