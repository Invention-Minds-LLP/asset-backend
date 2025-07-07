import { Request, Response } from "express";
import prisma from "../../prismaClient";

export const getAllTickets = async (req: Request, res: Response) => {
  const tickets = await prisma.ticket.findMany({ include: { asset: true, department: true } });
   res.json(tickets);
};

export const getTicketById = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: { asset: true, department: true } });
  if (!ticket) {
    res.status(404).json({ message: "Ticket not found" });
    return;
  }
   res.json(ticket);
};

export const createTicket = async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.create({ data: req.body });
   res.status(201).json(ticket);
};

export const updateTicket = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const ticket = await prisma.ticket.update({ where: { id }, data: req.body });
   res.json(ticket);
};

export const deleteTicket = async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  await prisma.ticket.delete({ where: { id } });
   res.status(204).send();
};
