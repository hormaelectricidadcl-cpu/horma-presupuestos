import React from 'react';

interface Item {
  id: number;
  categoria: string;
  description: string;
  price: number;
  quantity: number;
  total: number;
}

interface ItemListProps {
  items: Item[];
  removeItem: (id: number) => void;
}

const ItemList: React.FC<ItemListProps> = ({ items, removeItem }) => {
  return (
    <div className="item-list">
      <h2>Items Agregados</h2>
      {items.length === 0 ? (
        <p>No hay items agregados.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.description}</span>
              <span>{item.categoria} | ${item.price.toLocaleString('es-CL')} × {item.quantity} = ${item.total.toLocaleString('es-CL')}</span>
              <button onClick={() => removeItem(item.id)}>Eliminar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ItemList;