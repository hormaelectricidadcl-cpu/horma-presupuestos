import React from 'react';

interface Client {
  name: string;
  rut: string;
  email: string;
  address: string;
}

interface ClientFormProps {
  client: Client;
  setClient: React.Dispatch<React.SetStateAction<Client>>;
}

const ClientForm: React.FC<ClientFormProps> = ({ client, setClient }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setClient({ ...client, [name]: value });
  };

  return (
    <div className="client-form">
      <h2>Datos del Cliente</h2>
      <input
        type="text"
        name="name"
        placeholder="Nombre"
        value={client.name}
        onChange={handleChange}
      />
      <input
        type="text"
        name="rut"
        placeholder="RUT"
        value={client.rut}
        onChange={handleChange}
      />
      <input
        type="email"
        name="email"
        placeholder="Email"
        value={client.email}
        onChange={handleChange}
      />
      <input
        type="text"
        name="address"
        placeholder="Dirección"
        value={client.address}
        onChange={handleChange}
      />
    </div>
  );
};

export default ClientForm;