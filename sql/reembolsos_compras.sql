-- Cuando un trabajador paga una compra con su propia plata, la empresa
-- se la debe — distinto de un adelanto (empresa → trabajador) o una
-- compra normal (empresa paga directo). "pagado_por" identifica quién
-- la fronteó; "reembolsado" se marca true cuando ya se le devolvió.
alter table reportes_compras add column if not exists pagado_por text;
alter table reportes_compras add column if not exists reembolsado boolean not null default false;
